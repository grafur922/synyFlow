import { createHash } from 'node:crypto'
import type { RagInjectionFinding, RagRisk } from './rag.model'

type InjectionRule = {
  type: string
  severity: 'medium' | 'high'
  message: string
  pattern: RegExp
}

const RULES: InjectionRule[] = [
  { type: 'ignore_instructions', severity: 'high', message: '检测到要求忽略既有指令的内容', pattern: /(?:ignore|disregard|forget)\s+(?:all\s+)?(?:previous|prior|above)\s+(?:instructions?|rules?|messages?)|忽略(?:以上|之前|先前|所有)(?:指令|规则|消息)/giu },
  { type: 'role_override', severity: 'high', message: '检测到试图覆盖系统或开发者角色的内容', pattern: /(?:system|developer)\s+(?:prompt|message|instruction)|(?:系统|开发者)(?:提示词|消息|指令)/giu },
  { type: 'secret_exfiltration', severity: 'high', message: '检测到索取或外传秘密信息的内容', pattern: /(?:reveal|print|return|send|upload|exfiltrate).{0,80}(?:secret|token|password|credential|api key)|(?:泄露|输出|发送|上传).{0,40}(?:密钥|令牌|密码|凭证)/giu },
  { type: 'markup_role', severity: 'high', message: '检测到伪造模型角色标签', pattern: /<\/?(?:system|developer|assistant)>|\[(?:system|developer|assistant)\]/giu },
  { type: 'assistant_role', severity: 'medium', message: '检测到模型角色式文本', pattern: /^(?:assistant|system|developer|user)\s*:/gimu },
  { type: 'model_identity', severity: 'medium', message: '检测到要求模型切换身份的内容', pattern: /(?:you are|act as|pretend to be)\s+(?:chatgpt|an? ai|an? assistant)|(?:你是|扮演|假装成为).{0,30}(?:助手|模型|AI)/giu }
]

export class PromptInjectionScanner {
  scan(text: string) {
    const findings: RagInjectionFinding[] = []
    for (const rule of RULES) {
      rule.pattern.lastIndex = 0
      for (const match of text.matchAll(rule.pattern)) {
        const start = match.index || 0
        findings.push({
          id: createHash('sha256').update(`${rule.type}\0${start}\0${match[0]}`).digest('hex').slice(0, 24),
          severity: rule.severity,
          type: rule.type,
          message: rule.message,
          start,
          end: start + match[0].length
        })
        if (findings.length >= 100) return findings
      }
    }
    return findings.sort((a, b) => riskWeight(b.severity) - riskWeight(a.severity) || a.start - b.start)
  }

  risk(findings: RagInjectionFinding[]): RagRisk {
    if (findings.some((finding) => finding.severity === 'high')) return 'high'
    return findings.length ? 'medium' : 'none'
  }
}

function riskWeight(value: 'medium' | 'high') {
  return value === 'high' ? 2 : 1
}
