import path from 'node:path'

/**
 * 파일 확장자 → 프로그래밍 언어 매핑
 * Monaco Editor 및 구문 강조에 사용
 */
const EXTENSION_TO_LANGUAGE: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.py': 'python',
  '.rs': 'rust',
  '.go': 'go',
  '.java': 'java',
  '.c': 'c',
  '.cpp': 'cpp',
  '.cc': 'cpp',
  '.cxx': 'cpp',
  '.h': 'c',
  '.hpp': 'cpp',
  '.cs': 'csharp',
  '.rb': 'ruby',
  '.php': 'php',
  '.swift': 'swift',
  '.kt': 'kotlin',
  '.kts': 'kotlin',
  '.scala': 'scala',
  '.sh': 'shell',
  '.bash': 'shell',
  '.zsh': 'shell',
  '.json': 'json',
  '.xml': 'xml',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.toml': 'toml',
  '.ini': 'ini',
  '.cfg': 'ini',
  '.md': 'markdown',
  '.markdown': 'markdown',
  '.html': 'html',
  '.htm': 'html',
  '.css': 'css',
  '.scss': 'scss',
  '.sass': 'sass',
  '.less': 'less',
  '.sql': 'sql',
  '.graphql': 'graphql',
  '.gql': 'graphql',
  '.vue': 'html',
  '.svelte': 'html',
  '.dockerfile': 'dockerfile',
  '.r': 'r',
  '.lua': 'lua',
  '.dart': 'dart',
  '.ex': 'elixir',
  '.exs': 'elixir',
  '.erl': 'erlang',
  '.clj': 'clojure',
  '.hs': 'haskell',
  '.ml': 'ocaml',
  '.fs': 'fsharp',
  '.fsx': 'fsharp',
  '.vim': 'bat',
  '.bat': 'bat',
  '.ps1': 'powershell',
}

/**
 * 특수 파일명 → 언어 매핑 (확장자 없는 파일)
 */
const FILENAME_TO_LANGUAGE: Record<string, string> = {
  'dockerfile': 'dockerfile',
  'makefile': 'makefile',
  '.gitignore': 'ignore',
  '.dockerignore': 'ignore',
  '.env': 'ini',
  '.npmrc': 'ini',
  '.editorconfig': 'ini',
}

/**
 * 파일 경로에서 언어 감지
 */
export function detectLanguage(filePath: string): string {
  const basename = path.basename(filePath).toLowerCase()

  // 특수 파일명 먼저 확인
  if (FILENAME_TO_LANGUAGE[basename]) {
    return FILENAME_TO_LANGUAGE[basename]
  }

  const ext = path.extname(filePath).toLowerCase()
  return EXTENSION_TO_LANGUAGE[ext] ?? 'plaintext'
}

/**
 * 파일 트리에서 제외할 기본 패턴
 */
export const DEFAULT_IGNORE_PATTERNS = [
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  '.nuxt',
  '__pycache__',
  '.venv',
  'venv',
  '.env.local',
  '*.pyc',
  '.DS_Store',
  '.idea',
  '.vscode',
  '*.log',
  '.cache',
  '.turbo',
  'coverage',
  '.nyc_output',
]

/**
 * 디렉토리/파일이 ignore 패턴에 해당하는지 확인
 */
export function shouldIgnore(name: string): boolean {
  for (const pattern of DEFAULT_IGNORE_PATTERNS) {
    if (pattern === name) return true
    if (pattern.startsWith('*')) {
      const ext = pattern.slice(1)
      if (name.endsWith(ext)) return true
    }
  }
  return false
}
