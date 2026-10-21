import { schema } from '@chalkline/ir';
import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import { z } from 'zod';
import { BoardService, NotConfigured, type BoardDeps } from './board.js';
import { RegionBody, RenderBody } from './schemas.js';

/**
 * REST under /v1 for the board. Errors are RFC 9457 problem details with
 * stable `type` codes the web app maps to teacher-facing copy.
 *
 * Logging: Fastify's request log carries method, URL (ids only) and status;
 * bodies, which hold strokes and recognized content, are never logged.
 */

export type ServerOptions = { logger?: boolean };

const SessionParams = z.object({ sessionId: schema.Id });
const ExportParams = z.object({ exportId: schema.Id });

export function buildServer(deps: BoardDeps, options: ServerOptions = {}): FastifyInstance {
  const board = new BoardService(deps);
  // Render requests carry region images; 512 KB stroke requests stay far below this.
  const app = Fastify({ logger: options.logger ?? false, bodyLimit: 32 * 1024 * 1024 });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof NotConfigured) {
      return problem(reply, 503, 'recognition-not-configured', 'Handwriting recognition is off');
    }
    const { statusCode, code, name } = (error ?? {}) as {
      statusCode?: number;
      code?: string;
      name?: string;
    };
    if (statusCode && statusCode >= 400 && statusCode < 500) {
      return problem(reply, statusCode, 'invalid-request', 'The request could not be read');
    }
    // Ids and codes only: an error message could quote content.
    reply.log.error({ code, name }, 'failed');
    return problem(reply, 500, 'internal', 'Something went wrong on our side');
  });

  app.get('/v1/health', async () => board.health());

  app.post('/v1/sessions/:sessionId/regions', async (request, reply) => {
    const params = SessionParams.safeParse(request.params);
    const body = RegionBody.safeParse(request.body);
    if (!params.success || !body.success) {
      return problem(reply, 400, 'invalid-request', 'The region could not be read');
    }
    return board.recognize(body.data);
  });

  app.post('/v1/sessions/:sessionId/render', async (request, reply) => {
    const params = SessionParams.safeParse(request.params);
    const body = RenderBody.safeParse(request.body);
    if (!params.success || !body.success) {
      return problem(reply, 400, 'invalid-request', 'The notes could not be read');
    }
    return board.render(params.data.sessionId, body.data);
  });

  app.get('/v1/exports/:exportId', async (request, reply) => {
    const params = ExportParams.safeParse(request.params);
    const pdf = params.success ? board.exportPdf(params.data.exportId) : undefined;
    if (!pdf) return problem(reply, 404, 'export-not-found', 'That handout is no longer here');
    return reply
      .type('application/pdf')
      .header('Content-Disposition', 'inline; filename="handout.pdf"')
      .send(Buffer.from(pdf));
  });

  return app;
}

function problem(reply: FastifyReply, status: number, type: string, title: string) {
  return reply.code(status).type('application/problem+json').send({ type, title, status });
}
