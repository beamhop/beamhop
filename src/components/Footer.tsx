import { Logo } from "./icons";

export default function Footer() {
  return (
    <footer className="footer">
      <div className="footer-inner">
        <div>
          <a className="brand" href="#top" aria-label="Beamhop home">
            <Logo aria-hidden="true" />
            beamhop
          </a>
          <p className="tagline">
            Your company&rsquo;s sovereign agent network. You run it, you own it.
          </p>
        </div>
        <div className="meta">
          <span className="status-dot" aria-hidden="true" />
          network online · company-owned
        </div>
      </div>
    </footer>
  );
}
