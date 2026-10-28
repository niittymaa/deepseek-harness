/** Select the CLI model and effort before the recorded request. */
export const name = 'cli-selection-driver'

/** Mount the selection driver.
 * @param {import('@deepseek-ai/cordis').Context} ctx - Test composition context.
 */
export function apply(ctx) {
  ctx.on('agent/created', ({ agent }) => {
    agent.model.select({ provider: 'deepseek-official', model: 'selected-cli-model', reasoningEffort: 'high' })
  })
}
