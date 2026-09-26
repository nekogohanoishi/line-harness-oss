import { Hono } from 'hono';
import { getTags, getTagsWithCounts, createTag, deleteTag } from '@line-crm/db';
import type { Tag as DbTag } from '@line-crm/db';
import type { Env } from '../index.js';

const tags = new Hono<Env>();

function serializeTag(row: DbTag & { friend_count?: number }) {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    createdAt: row.created_at,
    ...(row.friend_count !== undefined ? { friendCount: row.friend_count } : {}),
  };
}

// GET /api/tags - list all tags
tags.get('/api/tags', async (c) => {
  try {
    const items = c.req.query('withCounts') === '1'
      ? await getTagsWithCounts(c.env.DB)
      : await getTags(c.env.DB);
    return c.json({ success: true, data: items.map(serializeTag) });
  } catch (err) {
    console.error('GET /api/tags error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// POST /api/tags - create tag
tags.post('/api/tags', async (c) => {
  try {
    const body = await c.req.json<{ name?: unknown; color?: string }>();

    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) {
      return c.json({ success: false, error: 'name is required' }, 400);
    }

    const tag = await createTag(c.env.DB, {
      name,
      color: body.color,
    });

    return c.json({ success: true, data: serializeTag(tag) }, 201);
  } catch (err) {
    if (err instanceof Error && err.message.includes('UNIQUE constraint')) {
      return c.json({ success: false, error: 'tag name already exists' }, 409);
    }
    console.error('POST /api/tags error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// DELETE /api/tags/:id - delete tag
tags.delete('/api/tags/:id', async (c) => {
  try {
    const id = c.req.param('id');
    await deleteTag(c.env.DB, id);
    return c.json({ success: true, data: null });
  } catch (err) {
    if (err instanceof Error && err.message.includes('FOREIGN KEY constraint')) {
      return c.json({ success: false, error: 'tag is referenced by other records' }, 409);
    }
    console.error('DELETE /api/tags/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

export { tags };
