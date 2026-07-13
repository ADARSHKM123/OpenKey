// M0 placeholder. Real UI (admin dashboard, employee portal, chat) lands in
// M4–M6 — the spec forbids UI work before the gateway hot path is proven.
export function App() {
  return (
    <main style={{ fontFamily: "system-ui", padding: "4rem", color: "#e4e4e7", background: "#09090b", minHeight: "100vh" }}>
      <h1>OpenKey</h1>
      <p>Self-hosted LLM gateway. UI coming in M4.</p>
    </main>
  );
}
