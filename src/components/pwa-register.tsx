"use client";

import { useEffect } from "react";

function base64UrlToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
}

export function PwaRegister({ enablePushPrompt = false }: { enablePushPrompt?: boolean }) {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
      return;
    }

    async function register() {
      const registration = await navigator.serviceWorker.register("/sw.js");
      const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

      if (
        !enablePushPrompt ||
        !vapidPublicKey ||
        !("PushManager" in window) ||
        Notification.permission === "denied"
      ) {
        return;
      }

      if (Notification.permission === "default") {
        const permission = await Notification.requestPermission();
        if (permission !== "granted") {
          return;
        }
      }

      const existingSubscription = await registration.pushManager.getSubscription();
      const subscription =
        existingSubscription ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: base64UrlToUint8Array(vapidPublicKey),
        }));

      await fetch("/api/push/subscriptions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          subscription: subscription.toJSON(),
          platform: /iPhone|iPad|iPod/i.test(window.navigator.userAgent)
            ? "ios"
            : /Android/i.test(window.navigator.userAgent)
              ? "android"
              : "web",
          deviceLabel: window.navigator.platform || "browser",
        }),
      });
    }

    void register();
  }, [enablePushPrompt]);

  return null;
}
