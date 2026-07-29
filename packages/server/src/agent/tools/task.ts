/**
 * Task tool — 서브에이전트를 spawn하여 집중적 하위 작업 수행 (→ 02-D).
 *
 * 서브에이전트는 읽기 전용 도구(read/grep/find/ls) + yield 로 제한된 환경에서
 * runAgentLoop 로 자율 실행된다. yield 호출 시 결과를 부모에게 반환.
 *
 * omp의 task 패턴 참조 (in-process AgentSession + restricted tools + yield).
 * worktree 격리는 추후 (현재는 동일 워크스페이스, exclusive 직렬화로 안전).
 */
import type { AgentTool, AgentContext, AgentLoopConfig, AgentEvent, Message } from '../types.js'
import { runAgentLoop } from '../loop.js'
import { getProvider } from '../index.js'
import { buildSystemPrompt } from '../system-prompt.js'
import { getModelConfigForRole } from '../model-config.js'
import { createReadOnlyTools } from './index.js'
import { createYieldTool } from './yield.js'
import type { ToolFactory } from './types.js'

export const createTaskTool: ToolFactory = (cwd, _options) => {
  const tool: AgentTool = {
    name: 'task',
    description: 'Spawn a subagent for a focused subtask (investigation, analysis, research). The subagent runs autonomously with read-only tools and yields a text result. Use for parallelizable work.',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'The task description for the subagent' },
      },
      required: ['prompt'],
    },
    async execute(_toolCallId, args) {
      const prompt = args.prompt as string

      // 서브에이전트 모델: 'smol' 역할 (저렴/빠른 모델) → 'default' 폴백
      const modelConfig = (await getModelConfigForRole('smol')) ?? (await getModelConfigForRole('default'))
      if (!modelConfig) {
        return {
          content: [{ type: 'text', text: 'No LLM provider configured. Set up a provider in Settings first.' }],
          isError: true,
        }
      }

      // yield 결과 캡처
      let yieldedResult: string | null = null
      const yieldTool = createYieldTool((result: string) => {
        yieldedResult = result
      })

      // 서브에이전트 도구: 읽기 전용 + yield
      const subTools = [...createReadOnlyTools(cwd), yieldTool]

      const systemPrompt = buildSystemPrompt({
        projectName: 'subagent',
        projectPath: cwd,
        tools: subTools,
        wikiPreamble: 'You are a focused subagent. Investigate the task, then call yield with your findings.',
      })

      const context: AgentContext = {
        systemPrompt,
        messages: [],
        tools: subTools,
        model: modelConfig,
      }

      const provider = getProvider(modelConfig)
      const loopConfig: AgentLoopConfig = {
        model: modelConfig,
        maxTurns: 10,
        toolExecution: 'parallel',
      }

      // 헤드리스 emit (서브에이전트 이벤트는 무시)
      const emit = async (_event: AgentEvent): Promise<void> => {
        /* headless subagent — no UI */
      }

      const finalMessages = await runAgentLoop(prompt, context, loopConfig, provider, emit)

      // yield 결과 또는 마지막 assistant 메시지
      const lastAssistant = [...finalMessages].reverse().find((m) => m.role === 'assistant')
      const lastText = lastAssistant?.content?.find((c) => c.type === 'text')
      const result = yieldedResult ?? lastText?.text ?? '(subagent produced no output)'

      return {
        content: [{ type: 'text', text: result }],
      }
    },
  }

  return tool
}
