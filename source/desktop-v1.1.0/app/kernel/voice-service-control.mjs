import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { ChatError } from './chat-errors.mjs'

/** Only the fixed local helper can manage its verified, owned voice process. */
export class VoiceServiceControl {
  constructor({ python, script, spawnImpl = spawn, exists = existsSync, onComplete = async () => true, timeoutMs = 150000 } = {}) {
    this.python=python; this.script=script; this.spawn=spawnImpl; this.exists=exists; this.onComplete=onComplete; this.timeoutMs=timeoutMs
    this.operation=null; this.lastError=null
  }
  snapshot() { return { available: !!(this.python && this.script && this.exists(this.python) && this.exists(this.script)), operation:this.operation, lastError:this.lastError } }
  request(action) {
    if (!['start','stop'].includes(action)) throw new ChatError('voice_operation_invalid')
    if (!this.snapshot().available) throw new ChatError('voice_control_unavailable')
    if (this.operation) {
      if (this.operation !== action) throw new ChatError('voice_operation_busy')
      return this.snapshot()
    }
    this.operation=action; this.lastError=null
    let child, timer, finishing=false
    const finish=async (ok, message=null) => {
      if (finishing) return
      finishing=true; clearTimeout(timer)
      try { if (ok) ok=await this.onComplete(action) } catch { ok=false }
      this.lastError=ok ? null : message || '语音服务操作未完成，请检查状态或本机语音安装。'
      this.operation=null
    }
    try {
      child=this.spawn(this.python,[this.script,action],{ windowsHide:true, shell:false, stdio:'ignore' })
      timer=setTimeout(()=>{ try { child.kill() } catch {}; void finish(false,'操作超时，请检查语音服务状态；必要时再次停止服务。') },this.timeoutMs)
      timer.unref?.()
      child.once('error',()=>void finish(false))
      child.once('close',code=>void finish(code===0))
    } catch { void finish(false) }
    return this.snapshot()
  }
}
