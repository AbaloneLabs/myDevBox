/**
 * Yield tool — 서브에이전트가 결과를 반환할 때 호출.
 * task 도구가 클로저로 onYield 콜백을 주입한다.
 */
import type { AgentTool } from '../types.js'

export function createYieldTool(onYield: (result: string) => void): AgentTool {
  return {
    name: 'yield',
    description: 'Return the final result of your task. Call this exactly once when your work is complete.',
    inputSchema: {
      type: 'object',
      properties: {
        result: { type: 'string', description: 'The result or findings of your task' },
      },
      required: ['result'],
    },
    async execute(_id, args) {
      const result = args.result as string
      onYield(result)
      return {
        content: [{ type: 'text', text: 'Result submitted. Task complete.' }],
        terminate: true,
      }
    },
  }
}
