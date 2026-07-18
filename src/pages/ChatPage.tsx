export default function ChatPage() {
  return (
    <div className="flex h-screen bg-gray-950 text-gray-100">
      <aside className="w-64 border-r border-gray-800 p-4">
        <h1 className="text-lg font-bold mb-4">Agent Chat</h1>
        <button className="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium hover:bg-blue-700 transition-colors">
          + 新建对话
        </button>
      </aside>

      <main className="flex-1 flex flex-col items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-semibold mb-2">Agent Chat</h2>
          <p className="text-gray-400">选择一个对话或创建新对话开始</p>
        </div>
      </main>
    </div>
  );
}