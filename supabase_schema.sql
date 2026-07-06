-- ==========================================================
-- SCHEMA DO DASHBOARD DE TENDÊNCIA - JARDINS ZURIQUE
-- Versão 1.0 (fase 1: sem auth, dados compartilhados)
-- ==========================================================

-- Tabela 1: Classificações e edições dos flows do sistema
CREATE TABLE flow_classifications (
  n_alteracao TEXT PRIMARY KEY,
  insumo_planejamento TEXT,
  insumo_remanejamento TEXT,
  custo_flowmaster NUMERIC,
  refletido_status TEXT CHECK (refletido_status IN ('pendente', 'sim', 'nao')),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by TEXT
);

-- Tabela 2: Aditivos manuais (criados no dashboard)
CREATE TABLE flow_manuals (
  n_alteracao TEXT PRIMARY KEY,
  n_adt TEXT,
  dep TEXT,
  descricao TEXT,
  data_br TEXT,
  data TEXT,
  aprovador_dep TEXT,
  aprovador TEXT,
  solicitante_dep TEXT,
  solicitante TEXT,
  custo_flowmaster NUMERIC,
  custo_planejamento NUMERIC,
  motivo TEXT,
  justificativa TEXT,
  insumo_planejamento TEXT,
  insumo_remanejamento TEXT,
  obs TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by TEXT
);

-- Tabela 3: Configuração global do Controle Projeção (linha única)
CREATE TABLE projecao_config (
  id INT PRIMARY KEY DEFAULT 1,
  insumo_controlado TEXT DEFAULT 'I011890',
  saldo_inicial NUMERIC,
  data_ref TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT single_row CHECK (id = 1)
);

-- Tabela 4: Movimentações manuais da Verba de Projeção
CREATE TABLE projecao_movimentacoes (
  id TEXT PRIMARY KEY,
  tipo TEXT CHECK (tipo IN ('aditivo', 'remanejamento', 'aporte', 'devolucao')),
  data TEXT,
  data_br TEXT,
  origem TEXT,
  destino TEXT,
  descricao TEXT,
  justificativa TEXT,
  responsavel TEXT,
  valor NUMERIC,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by TEXT
);

-- Tabela 5: Configurações gerais do dashboard (título editável, INCC/IPCA, modo card 3)
CREATE TABLE dashboard_config (
  chave TEXT PRIMARY KEY,
  valor TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ==========================================================
-- ROW LEVEL SECURITY (RLS)
-- Por enquanto: permitir tudo (fase 1 sem auth)
-- Na fase 3 vamos apertar essas regras
-- ==========================================================

ALTER TABLE flow_classifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE flow_manuals ENABLE ROW LEVEL SECURITY;
ALTER TABLE projecao_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE projecao_movimentacoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE dashboard_config ENABLE ROW LEVEL SECURITY;

-- Policies "permissivas" (permite qualquer operação pra anon)
-- ATENÇÃO: isso é intencional na Fase 1. Fase 3 vamos exigir auth.
CREATE POLICY "anon_all_flow_classifications" ON flow_classifications FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "anon_all_flow_manuals" ON flow_manuals FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "anon_all_projecao_config" ON projecao_config FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "anon_all_projecao_movimentacoes" ON projecao_movimentacoes FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "anon_all_dashboard_config" ON dashboard_config FOR ALL USING (true) WITH CHECK (true);

-- ==========================================================
-- ÍNDICES ÚTEIS (para performance nas queries frequentes)
-- ==========================================================

CREATE INDEX idx_flow_class_status ON flow_classifications (refletido_status);
CREATE INDEX idx_projecao_mov_data ON projecao_movimentacoes (data);
CREATE INDEX idx_projecao_mov_origem ON projecao_movimentacoes (origem);
CREATE INDEX idx_projecao_mov_destino ON projecao_movimentacoes (destino);

-- ==========================================================
-- CONFIG INICIAL PADRÃO
-- ==========================================================

-- Row única da config de projeção (com defaults)
INSERT INTO projecao_config (id, insumo_controlado)
VALUES (1, 'I011890')
ON CONFLICT (id) DO NOTHING;

-- ==========================================================
-- CONFERÊNCIA (execute pra verificar que tudo criou)
-- ==========================================================

SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY table_name;
