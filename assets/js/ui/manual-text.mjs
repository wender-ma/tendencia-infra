export const MANUAL_TEXT = Object.freeze({
  tendencia:
    '📈 ABA TENDÊNCIA (formato v0.55+)\n\nExporte da planilha:\n1. Abra o arquivo .xlsm\n2. Vá na aba TENDÊNCIA\n3. Arquivo → Salvar Como → CSV UTF-8 (.csv)\n4. Carregue aqui usando o botão "📤 Carregar CSV"\n\nO arquivo deve manter as colunas de Código, Serviço, Insumo, Item, Licitação, IPCA, INCC, Gestão, Diferença e Evoluções nas posições documentadas.\n\n⚠️ O formato antigo de 17 colunas não é mais aceito.\nVeja a aba "ℹ️ Manual" para detalhes completos.',
  flows:
    '🔗 ABA FlowsValor\n\nExporte da planilha:\n1. Abra o arquivo .xlsm\n2. Vá na aba FlowsValor (layout Fabric v0.63)\n3. Arquivo → Salvar Como → CSV UTF-8 (.csv)\n4. Carregue aqui\n\nO arquivo deve manter as 15 colunas na ordem oficial, de Cod_aditivo até Refletido.\n\n⚠️ As edições e aditivos manuais NÃO são apagados ao recarregar.\n\nVeja a aba "ℹ️ Manual" para detalhes completos.',
  gestoes:
    '📅 ABA Gestões\n\nExporte da planilha:\n1. Abra o arquivo .xlsm\n2. Vá na aba Gestões\n3. Arquivo → Salvar Como → CSV UTF-8 (.csv)\n4. Carregue aqui\n\nCabeçalhos obrigatórios: Descr_gestao, Descr_classificacaofinanceira, Key_planejamento, Val_totalliquido e Mes_pagamento.\n\nVeja a aba "ℹ️ Manual" para detalhes completos.',
});
