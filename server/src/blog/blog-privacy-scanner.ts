import { createHash } from 'node:crypto'
import type { PrivacyFinding, PrivacyFindingSeverity } from './blog.model'

type Rule = {
  type: string
  severity: PrivacyFindingSeverity
  message: string
  pattern: RegExp
}

const RULES: Rule[] = [
  { type: 'xiaomi_service_token', severity: 'high', message: '检测到小米 serviceToken', pattern: /serviceToken\s*[=:]\s*[A-Za-z0-9+/_%-]{20,}/gi },
  { type: 'openai_style_key', severity: 'high', message: '检测到疑似 API Key', pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/g },
  { type: 'aws_access_key', severity: 'high', message: '检测到 AWS Access Key', pattern: /\bAKIA[0-9A-Z]{16}\b/g },
  { type: 'bearer_token', severity: 'high', message: '检测到 Bearer Token', pattern: /\bBearer\s+[A-Za-z0-9._~+/-]{20,}={0,2}/gi },
  { type: 'jwt', severity: 'high', message: '检测到 JWT', pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g },
  { type: 'password_assignment', severity: 'high', message: '检测到密码或密钥赋值', pattern: /\b(password|passwd|pwd|secret|api[_-]?key|access[_-]?token)\s*[=:]\s*[^\s,;]{6,}/gi },
  { type: 'private_key', severity: 'high', message: '检测到私钥块', pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]{0,10000}?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g },
  { type: 'china_id', severity: 'high', message: '检测到疑似身份证号', pattern: /(?<!\d)\d{17}[\dXx](?!\d)/g },
  { type: 'private_ipv4', severity: 'medium', message: '检测到私网 IP 地址', pattern: /\b(?:10\.(?:\d{1,3}\.){2}\d{1,3}|192\.168\.(?:\d{1,3}\.)\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.(?:\d{1,3}\.)\d{1,3})\b/g },
  { type: 'china_phone', severity: 'medium', message: '检测到疑似中国大陆手机号', pattern: /(?<!\d)1[3-9]\d{9}(?!\d)/g },
  { type: 'email', severity: 'low', message: '检测到电子邮箱', pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi }
]

export class BlogPrivacyScanner {
  scan(text: string) {
    const findings: PrivacyFinding[] = []
    for (const rule of RULES) {
      rule.pattern.lastIndex = 0
      for (const match of text.matchAll(rule.pattern)) {
        const value = match[0]
        const start = match.index || 0
        findings.push({
          id: createHash('sha256').update(`${rule.type}\0${start}\0${value}`).digest('hex').slice(0, 24),
          type: rule.type,
          severity: rule.severity,
          message: rule.message,
          start,
          end: start + value.length,
          preview: redact(value)
        })
        if (findings.length >= 200) return findings
      }
    }
    return findings.sort((a, b) => severityWeight(b.severity) - severityWeight(a.severity) || a.start - b.start)
  }
}

function redact(value: string) {
  const compact = value.replace(/\s+/g, ' ')
  if (compact.length <= 8) return '*'.repeat(compact.length)
  return `${compact.slice(0, 4)}${'*'.repeat(Math.min(20, compact.length - 8))}${compact.slice(-4)}`
}

function severityWeight(value: PrivacyFindingSeverity) {
  return value === 'high' ? 3 : value === 'medium' ? 2 : 1
}
