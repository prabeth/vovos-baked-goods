import { db } from '@vercel/postgres';

export default async function handler(req: any, res: any) {
  const client = await db.connect();
  const { method } = req;

  try {
    if (method === 'GET') {
      const { rows } = await client.sql`SELECT * FROM products ORDER BY name ASC`;
      return res.status(200).json(rows);
    }
    res.status(405).json({ error: 'Método não permitido' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao buscar produtos' });
  } finally {
    client.release();
  }
}
