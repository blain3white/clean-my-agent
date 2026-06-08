import { translate } from '@/lib/i18n'
import { mockSessionDetail } from '@/lib/mock-data'
import type { AppLanguage, CleanMyAgentApi, UniversalRelayDocument } from '@/shared/types'

type SessionDetailCapableApi = Pick<CleanMyAgentApi, 'getSessionDetail'>

export function hasSessionDetailApi(
  api: Partial<CleanMyAgentApi> | undefined,
): api is SessionDetailCapableApi {
  return typeof api?.getSessionDetail === 'function'
}

export async function loadSessionDetail(
  api: Partial<CleanMyAgentApi> | undefined,
  sessionId: string,
  language: AppLanguage,
  mockDataEnabled: boolean,
): Promise<UniversalRelayDocument> {
  if (mockDataEnabled || !api) {
    return mockSessionDetail(sessionId)
  }

  if (!hasSessionDetailApi(api)) {
    throw new Error(translate(language, 'sessions.detailApiUnavailable'))
  }

  return api.getSessionDetail(sessionId)
}
