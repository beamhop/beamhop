import "./styles/sections.css";
import Nav from "./components/Nav";
import Hero from "./components/Hero";
import Floor from "./components/Floor";
import Security from "./components/Security";
import Automation from "./components/Automation";
import Connected from "./components/Connected";
import Memory from "./components/Memory";
import Final from "./components/Final";
import Footer from "./components/Footer";
import { useReducedMotion, useScrollReveal } from "./lib/motion";

export default function App() {
  const reduced = useReducedMotion();
  useScrollReveal(!reduced);

  return (
    <>
      <Nav />
      <main>
        <Hero />
        <hr className="divider" />
        <Floor />
        <hr className="divider" />
        <Security />
        <hr className="divider" />
        <Automation />
        <hr className="divider" />
        <Connected />
        <hr className="divider" />
        <Memory />
        <Final />
      </main>
      <Footer />
    </>
  );
}
