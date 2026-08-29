import {AboutControl} from "./components/about/AboutPanel";
import {WorldSatMonitor} from "./components/world-sat-monitor/WorldSatMonitor";

export default function Home() {
  return (
    <>
      <WorldSatMonitor/>
      <AboutControl/>
    </>
  );
}
