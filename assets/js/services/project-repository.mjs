export function createProjectRepository({ getClient, warn = () => {} }) {
  async function activeTendencyProjects(client) {
    try {
      const { data, error } = await client
        .from('dashboard_datasets')
        .select('codigo_obra')
        .eq('tipo', 'tendencia')
        .eq('status', 'active')
        .not('codigo_obra', 'is', null);
      if (error) throw error;
      return new Set((data || []).map((dataset) => dataset.codigo_obra).filter(Boolean));
    } catch (error) {
      warn('Obras/carregar disponibilidade pública', error);
      return new Set();
    }
  }

  async function listProjects() {
    const client = getClient?.();
    if (!client) return [];
    try {
      const [{ data, error }, availableProjects] = await Promise.all([
        client.from('obras').select('*').order('nome', { ascending: true }),
        activeTendencyProjects(client),
      ]);
      if (error) throw error;
      const projects = data || [];
      return projects.map((project) => ({
        ...project,
        hasActiveTendency: availableProjects.has(project.codigo_obra),
      }));
    } catch (error) {
      warn('Obras/carregar catálogo', error);
      return [];
    }
  }

  return Object.freeze({ listProjects });
}
