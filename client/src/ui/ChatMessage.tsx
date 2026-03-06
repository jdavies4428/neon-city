import React, { useState } from "react";

interface ChatMessageProps {
  role: string;
  content: string;
  children: React.ReactNode;
}

const MAX_COLLAPSED_LINES = 10;

export const ChatMessage: React.FC<ChatMessageProps> = ({
  role,
  content,
  children,
}) => {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const lines = content.split("\n");
  const isLong = lines.length > MAX_COLLAPSED_LINES;

  const copyToClipboard = () => {
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="chat-msg-wrapper">
      <button
        className="chat-msg-copy-all"
        onClick={copyToClipboard}
        title="Copy message"
      >
        {copied ? "Copied!" : "Copy"}
      </button>

      <div className={`chat-msg-body ${isLong && !expanded ? "chat-msg-collapsed" : ""}`}>
        {children}
      </div>

      {isLong && (
        <button
          className="chat-msg-expand"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? "Collapse" : `Show all (${lines.length} lines)`}
        </button>
      )}
    </div>
  );
};
