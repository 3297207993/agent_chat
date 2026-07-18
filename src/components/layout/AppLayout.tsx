import { Outlet } from "react-router-dom";
import TopBar from "./TopBar";
import Sidebar from "./Sidebar";
import RightPanel from "./RightPanel";

export default function AppLayout() {
  return (
    <div className="flex flex-col h-screen bg-[#0d1117] text-[#e6edf3]">
      <TopBar />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <main className="flex-1 min-w-0 overflow-hidden">
          <Outlet />
        </main>
        <RightPanel />
      </div>
    </div>
  );
}