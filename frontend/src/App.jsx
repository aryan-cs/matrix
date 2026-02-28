import DotWaveBackground from "./components/DotWaveBackground";

const navItems = ["New chat", "Search chats", "Simulations", "Scenarios", "Reports"];
const recentItems = [
  "Illinois Bill Reaction",
  "NYC Rent Control Draft",
  "Universal Basic Income",
  "EV Incentive Rollout",
  "School Lunch Reform"
];

function App() {
  return (
    <div className="app-shell">
      <DotWaveBackground />

      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">M</div>
          <div>
            <p className="brand-title">Matrix</p>
            <p className="brand-subtitle">simulate any society</p>
          </div>
        </div>

        <nav className="primary-nav">
          {navItems.map((item) => (
            <button className="nav-row" key={item} type="button">
              <span className="nav-dot" />
              {item}
            </button>
          ))}
        </nav>

        <div className="chat-history">
          <p className="history-label">Recent runs</p>
          {recentItems.map((item) => (
            <button className="history-row" key={item} type="button">
              {item}
            </button>
          ))}
        </div>

        <div className="sidebar-footer">
          <div className="avatar">AG</div>
          <div>
            <p className="user-name">Aryan Gupta</p>
            <p className="user-plan">Builder</p>
          </div>
        </div>
      </aside>

      <main className="main-panel">
        <header className="topbar">
          <button className="top-pill" type="button">
            Matrix Simulator
          </button>
        </header>

        <section className="hero">
          <p className="hero-eyebrow">Agent-Based Foresight</p>
          <h1>What do you want to simulate?</h1>

          <form
            className="composer"
            onSubmit={(event) => {
              event.preventDefault();
            }}
          >
            <button className="icon-btn" type="button" aria-label="Attach scenario data">
              +
            </button>
            <input
              type="text"
              placeholder="Describe a policy, product launch, or social event..."
              aria-label="Simulation scenario"
            />
            <button className="send-btn" type="submit">
              Run
            </button>
          </form>

          <div className="suggestions">
            <button type="button">Illinois labor bill impact</button>
            <button type="button">Tuition freeze at state colleges</button>
            <button type="button">Citywide congestion pricing</button>
          </div>
        </section>
      </main>
    </div>
  );
}

export default App;
