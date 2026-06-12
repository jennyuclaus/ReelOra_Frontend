import { Html, Head, Main, NextScript } from "next/document";

export default function Document() {
  return (
    <Html lang="de">
      <Head />
      <body>
        {/* Splash screen – verschwindet sobald React hydrated */}
        <div id="splash" style={{
          position: "fixed", inset: 0, zIndex: 9999,
          background: "linear-gradient(160deg,#0a0a1a 0%,#1a0a08 50%,#0f0a08 100%)",
          display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center", gap: 20,
          transition: "opacity 0.5s ease",
        }}>
          <img
            src="/icons/icon-192.png"
            alt="MusigPlayer"
            style={{ width: 120, height: 120, borderRadius: 28, boxShadow: "0 0 60px rgba(249,115,22,0.7)" }}
          />
          <div style={{
            fontSize: 28, fontWeight: 800, letterSpacing: "-0.5px",
            background: "linear-gradient(90deg,#fb923c,#fb923c,#fb923c)",
            WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
          }}>
            MusigPlayer
          </div>
          <div style={{ width: 48, height: 4, borderRadius: 2, background: "rgba(255,255,255,0.1)", overflow: "hidden", marginTop: 8 }}>
            <div style={{
              height: "100%", borderRadius: 2,
              background: "linear-gradient(90deg,#c0392b,#fb923c)",
              animation: "splash-bar 1.4s ease-in-out infinite",
            }} />
          </div>
          <style>{`
            @keyframes splash-bar {
              0%   { width: 0%; margin-left: 0%; }
              50%  { width: 60%; margin-left: 20%; }
              100% { width: 0%; margin-left: 100%; }
            }
          `}</style>
        </div>

        <script dangerouslySetInnerHTML={{ __html: `
          // SW-Reset: einmalig alle alten SWs entfernen (Version 2)
          var SW_VERSION = 'v2';
          if ('serviceWorker' in navigator && localStorage.getItem('sw_version') !== SW_VERSION) {
            navigator.serviceWorker.getRegistrations().then(function(regs) {
              var promises = regs.map(function(r) { return r.unregister(); });
              Promise.all(promises).then(function() {
                localStorage.setItem('sw_version', SW_VERSION);
                if (regs.length > 0) window.location.reload();
              });
            });
          }

          // Splash ausblenden
          window.addEventListener('load', function() {
            var s = document.getElementById('splash');
            if (s) { s.style.opacity = '0'; setTimeout(function(){ s.style.display='none'; }, 520); }
          });
        `}} />

        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
