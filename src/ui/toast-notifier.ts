export class ToastNotifier {
  private client: any

  constructor(client: any) {
    this.client = client
  }

  async warning(message: string, title?: string, duration?: number): Promise<void> {
    try {
      if (!this.client?.tui?.showToast) {
        console.warn('[opencode-models-discovery-proxy] Toast API not available (client.tui.showToast missing)')
        return
      }
      await this.client.tui.showToast({
        body: { title, message, variant: 'warning', duration: duration || 4000 }
      })
    } catch (error) {
      console.error(`[opencode-models-discovery-proxy] Failed to show warning toast`, error)
    }
  }

  async error(message: string, title?: string, duration?: number): Promise<void> {
    try {
      if (!this.client?.tui?.showToast) {
        console.warn('[opencode-models-discovery-proxy] Toast API not available (client.tui.showToast missing)')
        return
      }
      await this.client.tui.showToast({
        body: { title, message, variant: 'error', duration: duration || 5000 }
      })
    } catch (error) {
      console.error(`[opencode-models-discovery-proxy] Failed to show error toast`, error)
    }
  }
}
