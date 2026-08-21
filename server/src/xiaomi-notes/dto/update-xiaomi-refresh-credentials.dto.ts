import type { XiaomiRefreshCredentialUpdate } from '../xiaomi-passport.service'

export class UpdateXiaomiRefreshCredentialsDto implements XiaomiRefreshCredentialUpdate {
  passToken?: string
  userId?: string
  cUserId?: string
  deviceId?: string
}
