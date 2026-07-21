export function createProjectRepository({ getClient, warn = () => {} }) {
  async function listProjects() {
    const client = getClient?.();
    if (!client) return [];
    try {
      const { data, error } = await client
        .from('obras')
        .select('*')
        .order('nome', { ascending: true });
      if (error) throw error;
      return data || [];
    } catch (error) {
      warn('Obras/carregar catálogo', error);
      return [];
    }
  }

  return Object.freeze({ listProjects });
}
