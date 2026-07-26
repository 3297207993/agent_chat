import { createHighlighter } from "shiki";

let highlighterPromise: ReturnType<typeof createHighlighter> | null = null;

const COMMON_LANGS = [
  "javascript",
  "typescript",
  "tsx",
  "jsx",
  "python",
  "rust",
  "go",
  "java",
  "c",
  "cpp",
  "csharp",
  "css",
  "html",
  "json",
  "yaml",
  "markdown",
  "sql",
  "bash",
  "shell",
  "powershell",
  "dockerfile",
  "toml",
  "xml",
  "graphql",
  "lua",
  "ruby",
  "php",
  "swift",
  "kotlin",
  "scala",
  "r",
  "diff",
  "text",
  "plaintext",
  "txt",
];

export function getHighlighter(): ReturnType<typeof createHighlighter> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: ["github-dark"],
      langs: COMMON_LANGS,
    });
  }
  return highlighterPromise;
}

export async function highlightCode(code: string, lang: string): Promise<string> {
  const highlighter = await getHighlighter();
  const langLower = lang.toLowerCase();
  const loadedLangs = highlighter.getLoadedLanguages();
  const useLang = loadedLangs.includes(langLower) ? langLower : "text";

  return highlighter.codeToHtml(code, {
    lang: useLang,
    theme: "github-dark",
  });
}