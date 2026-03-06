import { expect, test } from "@playwright/test";

test("workspace, chat, alerts, and history stay wired together", async ({ page }) => {
  let sentPayload: { message?: string; sessionId?: string; projectPath?: string } | null = null;

  await page.addInitScript(() => {
    class MockWebSocket {
      static OPEN = 1;
      readyState = 1;
      url: string;
      onopen: ((event: Event) => void) | null = null;
      onmessage: ((event: MessageEvent) => void) | null = null;
      onclose: ((event: CloseEvent) => void) | null = null;
      onerror: ((event: Event) => void) | null = null;

      constructor(url: string) {
        this.url = url;
        setTimeout(() => {
          this.onopen?.(new Event("open"));
          this.onmessage?.(new MessageEvent("message", {
            data: JSON.stringify({
              type: "init",
              data: {
                agents: [],
                notifications: [{
                  id: "notif-1",
                  type: "info",
                  agentId: "session-1",
                  agentName: "Claude",
                  description: "Deploy ready",
                  timestamp: Date.now(),
                  resolved: false,
                }],
                chatHistory: [],
                weather: { state: "clear", reason: "Normal operations", lastCheck: Date.now() },
                toolActivities: [],
                stats: {
                  activeAgents: 1,
                  totalProjects: 2,
                  totalSessions: 5,
                  totalMessages: 20,
                  totalTokens: 1200,
                  estimatedCost: 0.12,
                  tokens24h: 900,
                },
              },
            }),
          }));
        }, 0);
      }

      send() {}
      close() {
        this.onclose?.(new CloseEvent("close"));
      }

      addEventListener() {}
      removeEventListener() {}
    }

    Object.defineProperty(window, "WebSocket", {
      configurable: true,
      writable: true,
      value: MockWebSocket,
    });
  });

  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const { pathname } = url;

    if (pathname === "/api/sessions/active") {
      return route.fulfill({
        json: {
          sessions: [{
            sessionId: "session-1",
            label: "Cursor — neon-city",
            agentName: "Claude (Cursor)",
            projectName: "neon-city",
            projectPath: "/tmp/neon-city",
            status: "idle",
            lastActivity: Date.now(),
            color: "#00f0ff",
            isLive: true,
            ideName: "Cursor",
          }],
        },
      });
    }

    if (pathname === "/api/history/projects") {
      return route.fulfill({
        json: {
          projects: [{
            id: 1,
            path: "/tmp/neon-city",
            name: "neon-city",
            session_count: 3,
            last_indexed: Date.now(),
          }],
        },
      });
    }

    if (pathname === "/api/history/sessions") {
      return route.fulfill({
        json: {
          sessions: [{
            id: "session-1",
            title: "Investigate dashboard bug",
            message_count: 5,
            first_message_at: Date.now(),
            last_message_at: Date.now(),
            project_name: "neon-city",
            project_path: "/tmp/neon-city",
          }],
        },
      });
    }

    if (pathname === "/api/history/plans") {
      return route.fulfill({ json: { plans: [] } });
    }

    if (pathname === "/api/history/stats") {
      return route.fulfill({ json: { projects: 1, sessions: 1, messages: 5, plans: 0 } });
    }

    if (pathname === "/api/chat/history") {
      return route.fulfill({ json: { messages: [] } });
    }

    if (pathname === "/api/chat/send") {
      sentPayload = route.request().postDataJSON() as typeof sentPayload;
      return route.fulfill({ json: { ok: true, id: "msg-1", mode: "session" } });
    }

    if (pathname === "/api/stats") {
      return route.fulfill({
        json: {
          activeAgents: 1,
          totalProjects: 1,
          totalSessions: 5,
          totalTokens: 1200,
          estimatedCost: 0.12,
          tokens24h: 900,
        },
      });
    }

    if (pathname === "/api/git/status") {
      return route.fulfill({
        json: { branch: "main", files: [], dirty: false, ahead: 0, behind: 0, fileCount: 0 },
      });
    }

    if (pathname === "/api/voice/status") {
      return route.fulfill({ json: { enabled: false, ttsReady: false } });
    }

    return route.fulfill({ json: {} });
  });

  await page.goto("/");

  await expect(page.getByRole("button", { name: /Workspace/i })).toBeVisible();
  await expect(page.locator(".workspace-trigger-name")).toHaveText("neon-city");

  await page.getByRole("button", { name: "Chat" }).first().click();
  await expect(page.getByText("Workspace: neon-city")).toBeVisible();
  await page.locator('textarea[name="chat-message"]').fill("Check the dashboard");
  await page.locator(".chat-send").click();

  await expect.poll(() => sentPayload).toMatchObject({
    message: "Check the dashboard",
    sessionId: "session-1",
    projectPath: "/tmp/neon-city",
  });

  await page.getByRole("button", { name: "Alerts" }).first().click();
  await expect(page.getByText("Deploy ready")).toBeVisible();

  await page.getByRole("button", { name: "History" }).first().click();
  await expect(page.getByText("Investigate dashboard bug")).toBeVisible();
});
