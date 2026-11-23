import { parseBody, route } from '@/server/http'
import { account, saveAttempts } from '@/server/learning'

export const POST = route(async (request: Request) => saveAttempts(await account(request, true), await parseBody(request)))
