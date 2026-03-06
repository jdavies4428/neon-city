import { useEffect, useState, useCallback } from "react";
import type { RawMessageListener } from "./useCityState";

type SubscribeFn = (listener: RawMessageListener) => () => void;

export function useDesktopNotifications(subscribeToMessages: SubscribeFn) {
  const [permission, setPermission] = useState<NotificationPermission>(
    typeof Notification !== "undefined" ? Notification.permission : "denied"
  );

  const requestPermission = useCallback(async () => {
    if (typeof Notification === "undefined") return;
    const result = await Notification.requestPermission();
    setPermission(result);
  }, []);

  useEffect(() => {
    if (permission !== "granted") return;

    return subscribeToMessages((msg) => {
      if (document.hasFocus()) return;

      if (msg.type === "notification") {
        const n = msg.data;
        if (n.type === "approval-needed") {
          new Notification("Neon City — Approval Needed", {
            body: `${n.agentName}: ${n.description}`,
            icon: "/favicon.svg",
            tag: n.id,
          });
        } else if (n.type === "task-complete") {
          new Notification("Neon City — Task Complete", {
            body: `${n.agentName}: ${n.description}`,
            icon: "/favicon.svg",
            tag: n.id,
          });
        } else if (n.type === "error") {
          new Notification("Neon City — Error", {
            body: `${n.agentName}: ${n.description}`,
            icon: "/favicon.svg",
            tag: n.id,
          });
        }
      }

      if (msg.type === "spawn-complete") {
        new Notification("Neon City — Agent Finished", {
          body: "Agent completed its task",
          icon: "/favicon.svg",
        });
      }
    });
  }, [permission, subscribeToMessages]);

  return { permission, requestPermission };
}
