export const registerServiceWorker = () => {
  // Le navigateur expose cette API uniquement si les service workers sont supportes.
  if (!("serviceWorker" in navigator)) return;

  if (import.meta.env.DEV) {
    window.addEventListener("load", () => {
      navigator.serviceWorker
        .getRegistrations()
        .then((registrations) =>
          Promise.all(registrations.map((registration) => registration.unregister())),
        )
        .catch(() => {
          // Development should not fail because of service worker cleanup.
        });

      if ("caches" in window) {
        caches
          .keys()
          .then((cacheNames) =>
            Promise.all(
              cacheNames
                .filter((cacheName) => cacheName.startsWith("mappening-"))
                .map((cacheName) => caches.delete(cacheName)),
            ),
          )
          .catch(() => {
            // Cache cleanup is best-effort in development.
          });
      }
    });
    return;
  }

  window.addEventListener("load", () => {
    // Demande au navigateur d'utiliser /sw.js comme service worker de l'application.
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Registration can fail in unsupported local or private browsing contexts.
    });
  });
};
