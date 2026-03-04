import { useEffect, useState, useCallback } from "react";
import { basename } from "../shared/format";

interface TreeEntry {
  name: string;
  path: string;
  type: "file" | "dir";
  size?: number;
  children?: TreeEntry[];
}

interface Project {
  id: number;
  path: string;
  name: string;
  session_count: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
  project: Project | null;
  onOpenProject: (projectPath: string) => void;
}

// ─── Minimal Markdown Renderer ─────────────────────────────

function renderMarkdown(content: string): JSX.Element {
  const lines = content.split("\n");
  const elements: JSX.Element[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Code block
    if (line.startsWith("```")) {
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing ```
      elements.push(
        <pre key={key++}>
          <code>{codeLines.join("\n")}</code>
        </pre>
      );
      continue;
    }

    // Headings
    if (line.startsWith("### ")) {
      elements.push(<h3 key={key++}>{inlineFormat(line.slice(4))}</h3>);
      i++;
      continue;
    }
    if (line.startsWith("## ")) {
      elements.push(<h2 key={key++}>{inlineFormat(line.slice(3))}</h2>);
      i++;
      continue;
    }
    if (line.startsWith("# ")) {
      elements.push(<h1 key={key++}>{inlineFormat(line.slice(2))}</h1>);
      i++;
      continue;
    }

    // Horizontal rule
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
      elements.push(<hr key={key++} />);
      i++;
      continue;
    }

    // Blockquote
    if (line.startsWith("> ")) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].startsWith("> ")) {
        quoteLines.push(lines[i].slice(2));
        i++;
      }
      elements.push(
        <blockquote key={key++}>
          {quoteLines.map((ql, qi) => (
            <p key={qi}>{inlineFormat(ql)}</p>
          ))}
        </blockquote>
      );
      continue;
    }

    // Unordered list
    if (/^[\-\*]\s/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[\-\*]\s/.test(lines[i])) {
        items.push(lines[i].replace(/^[\-\*]\s/, ""));
        i++;
      }
      elements.push(
        <ul key={key++}>
          {items.map((item, ii) => (
            <li key={ii}>{inlineFormat(item)}</li>
          ))}
        </ul>
      );
      continue;
    }

    // Ordered list
    if (/^\d+\.\s/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s/.test(lines[i])) {
        items.push(lines[i].replace(/^\d+\.\s/, ""));
        i++;
      }
      elements.push(
        <ol key={key++}>
          {items.map((item, ii) => (
            <li key={ii}>{inlineFormat(item)}</li>
          ))}
        </ol>
      );
      continue;
    }

    // Empty line
    if (line.trim() === "") {
      i++;
      continue;
    }

    // Paragraph
    elements.push(<p key={key++}>{inlineFormat(line)}</p>);
    i++;
  }

  return <>{elements}</>;
}

function inlineFormat(text: string): React.ReactNode {
  // Process inline code, bold, italic, links
  const parts: React.ReactNode[] = [];
  let remaining = text;
  let k = 0;

  while (remaining.length > 0) {
    // Inline code
    const codeMatch = remaining.match(/^(.*?)`([^`]+)`(.*)$/);
    if (codeMatch) {
      if (codeMatch[1]) parts.push(codeMatch[1]);
      parts.push(<code key={k++}>{codeMatch[2]}</code>);
      remaining = codeMatch[3];
      continue;
    }

    // Bold
    const boldMatch = remaining.match(/^(.*?)\*\*(.+?)\*\*(.*)$/);
    if (boldMatch) {
      if (boldMatch[1]) parts.push(boldMatch[1]);
      parts.push(<strong key={k++}>{boldMatch[2]}</strong>);
      remaining = boldMatch[3];
      continue;
    }

    // Italic
    const italicMatch = remaining.match(/^(.*?)\*(.+?)\*(.*)$/);
    if (italicMatch) {
      if (italicMatch[1]) parts.push(italicMatch[1]);
      parts.push(<em key={k++}>{italicMatch[2]}</em>);
      remaining = italicMatch[3];
      continue;
    }

    // Link
    const linkMatch = remaining.match(/^(.*?)\[([^\]]+)\]\(([^)]+)\)(.*)$/);
    if (linkMatch) {
      if (linkMatch[1]) parts.push(linkMatch[1]);
      parts.push(
        <a key={k++} href={linkMatch[3]} target="_blank" rel="noopener noreferrer">
          {linkMatch[2]}
        </a>
      );
      remaining = linkMatch[4];
      continue;
    }

    // Plain text
    parts.push(remaining);
    break;
  }

  return parts.length === 1 ? parts[0] : <>{parts}</>;
}

// ─── File Icons ────────────────────────────────────────────

function getFileIcon(name: string): string {
  const ext = name.includes(".") ? name.split(".").pop()?.toLowerCase() : "";
  switch (ext) {
    case "md":
    case "prd":
    case "txt":
      return "\u{1F4C4}"; // page
    case "json":
    case "yaml":
    case "yml":
    case "toml":
      return "\u{2699}"; // gear
    case "ts":
    case "tsx":
    case "js":
    case "jsx":
      return "\u{1F4DC}"; // scroll
    case "css":
    case "html":
    case "svg":
      return "\u{1F3A8}"; // art palette
    case "py":
    case "go":
    case "rs":
    case "java":
      return "\u{1F4DC}"; // scroll
    case "sh":
      return "\u25B8"; // triangle
    default:
      return "\u25C7"; // diamond
  }
}

// ─── Component ─────────────────────────────────────────────

export function ProjectDetailModal({ open, onClose, project, onOpenProject }: Props) {
  const [tree, setTree] = useState<TreeEntry[]>([]);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [treeLoading, setTreeLoading] = useState(false);

  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [fileExt, setFileExt] = useState<string>("");
  const [fileLoading, setFileLoading] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);

  const [opening, setOpening] = useState(false);

  // Load root tree when project changes
  useEffect(() => {
    if (!open || !project?.path) return;
    setTree([]);
    setExpandedDirs(new Set());
    setSelectedFile(null);
    setFileContent(null);
    setFileError(null);
    setOpening(false);
    loadTree(project.path);
  }, [open, project?.path]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadTree = useCallback(async (dirPath: string) => {
    setTreeLoading(true);
    try {
      const res = await fetch(`/api/projects/tree?path=${encodeURIComponent(dirPath)}`);
      const data = await res.json();
      if (data.entries) {
        if (dirPath === project?.path) {
          setTree(data.entries);
          // Auto-expand and find first README
          const readme = data.entries.find(
            (e: TreeEntry) => e.type === "file" && /^readme\.md$/i.test(e.name)
          );
          if (readme) {
            selectFile(readme.path);
          }
        } else {
          // Merge children into existing tree
          setTree((prev) => mergeChildren(prev, dirPath, data.entries));
        }
      }
    } catch {
      // silently fail — tree just won't expand
    } finally {
      setTreeLoading(false);
    }
  }, [project?.path]); // eslint-disable-line react-hooks/exhaustive-deps

  function mergeChildren(entries: TreeEntry[], parentPath: string, children: TreeEntry[]): TreeEntry[] {
    return entries.map((e) => {
      if (e.path === parentPath) {
        return { ...e, children };
      }
      if (e.children) {
        return { ...e, children: mergeChildren(e.children, parentPath, children) };
      }
      return e;
    });
  }

  async function toggleDir(dirPath: string) {
    if (expandedDirs.has(dirPath)) {
      setExpandedDirs((prev) => {
        const next = new Set(prev);
        next.delete(dirPath);
        return next;
      });
    } else {
      setExpandedDirs((prev) => new Set(prev).add(dirPath));
      await loadTree(dirPath);
    }
  }

  async function selectFile(filePath: string) {
    setSelectedFile(filePath);
    setFileContent(null);
    setFileError(null);
    setFileLoading(true);

    try {
      const res = await fetch(`/api/projects/file?path=${encodeURIComponent(filePath)}`);
      const data = await res.json();
      if (res.ok) {
        setFileContent(data.content);
        setFileExt(data.extension || "");
      } else {
        setFileError(data.error || "Failed to load file");
      }
    } catch {
      setFileError("Network error");
    } finally {
      setFileLoading(false);
    }
  }

  async function handleOpenProject() {
    if (!project?.path || opening) return;
    setOpening(true);

    try {
      await fetch("/api/spawn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: "You are now working on this project. Explore the codebase and wait for instructions.",
          projectPath: project.path,
          agentType: "general-purpose",
        }),
      });
      // Close modal after short delay to let the agent appear
      setTimeout(() => {
        onOpenProject(project.path);
        onClose();
        setOpening(false);
      }, 800);
    } catch {
      setOpening(false);
    }
  }

  // Escape key
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open || !project) return null;

  function renderEntry(entry: TreeEntry, depth: number): JSX.Element {
    const isDir = entry.type === "dir";
    const isExpanded = expandedDirs.has(entry.path);
    const isSelected = selectedFile === entry.path;

    return (
      <div key={entry.path}>
        <button
          className={`tree-entry${isDir ? " dir" : ""}${isSelected ? " selected" : ""}`}
          style={{ paddingLeft: `${10 + depth * 16}px` }}
          onClick={() => (isDir ? toggleDir(entry.path) : selectFile(entry.path))}
        >
          <span className="tree-icon">
            {isDir ? (isExpanded ? "\u25BE" : "\u25B8") : getFileIcon(entry.name)}
          </span>
          <span className="tree-name">{entry.name}</span>
        </button>
        {isDir && isExpanded && entry.children?.map((child) => renderEntry(child, depth + 1))}
      </div>
    );
  }

  const isMarkdown = fileExt === ".md" || fileExt === ".prd";
  const fileName = selectedFile ? basename(selectedFile) || selectedFile : null;

  return (
    <div className="project-detail-overlay" onClick={onClose}>
      <div className="project-detail-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="project-detail-header">
          <div className="project-detail-header-info">
            <div className="project-detail-name">{project.name.toUpperCase()}</div>
            <div className="project-detail-path">{project.path}</div>
            <div className="project-detail-stats">
              {project.session_count} session{project.session_count !== 1 ? "s" : ""}
            </div>
          </div>
          <button className="project-detail-close" onClick={onClose}>
            {"\u00D7"}
          </button>
        </div>

        {/* Body */}
        <div className="project-detail-body">
          {/* File Tree */}
          <div className="project-detail-tree">
            {treeLoading && tree.length === 0 && (
              <div className="tree-loading">Loading...</div>
            )}
            {tree.map((entry) => renderEntry(entry, 0))}
            {!treeLoading && tree.length === 0 && (
              <div className="tree-loading">No files found</div>
            )}
          </div>

          {/* Preview */}
          <div className="project-detail-preview">
            {fileLoading && (
              <div className="preview-empty">
                <div className="preview-empty-icon">{"\u23F3"}</div>
                <div>Loading...</div>
              </div>
            )}
            {fileError && <div className="preview-error">{fileError}</div>}
            {!selectedFile && !fileLoading && (
              <div className="preview-empty">
                <div className="preview-empty-icon">{"\u{1F4C2}"}</div>
                <div>Select a file to preview</div>
              </div>
            )}
            {fileContent !== null && !fileLoading && (
              <>
                <div className="preview-filename">{fileName}</div>
                {isMarkdown ? (
                  <div className="md-preview">{renderMarkdown(fileContent)}</div>
                ) : (
                  <pre className="code-preview">{fileContent}</pre>
                )}
              </>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="project-detail-footer">
          <button
            className="open-project-btn"
            onClick={handleOpenProject}
            disabled={opening}
          >
            {opening ? "OPENING..." : "OPEN PROJECT"}
          </button>
        </div>
      </div>
    </div>
  );
}
