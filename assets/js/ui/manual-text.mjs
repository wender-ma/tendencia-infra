export const MANUAL_TEXT = Object.freeze({
  tendencia:
    '📈 ABA TENDÊNCIA (formato v0.55+)\n\nExporte da planilha:\n1. Abra o arquivo .xlsm\n2. Vá na aba TENDÊNCIA\n3. Arquivo → Salvar Como → CSV UTF-8 (.csv)\n4. Carregue aqui usando o botão "📤 Carregar CSV"\n\nO arquivo deve manter as colunas de Código, Serviço, Insumo, Item, Licitação, IPCA, INCC, Gestão, Diferença e Evoluções nas posições documentadas.\n\n⚠️ O formato antigo de 17 colunas não é mais aceito.\nVeja a aba "ℹ️ Manual" para detalhes completos.',
  flows:
    '🔗 ABA Aditivos_flowmaster\n\nUse a planilha oficial no formato Excel ou exporte a aba Aditivos_flowmaster como CSV UTF-8.\n\nCabeçalhos obrigatórios: Cod_aditivo, Descr_status, Descr_areaatual, Descr_setorcriacao, Data_criacao, Descr_motivo, Descr_observacao_motivo, Descr_descricaoaditivo, Cod_obra, Valor Aprovado ou Solicitado e Vlr_planejamento.\n\nVlr_estimado, Departamento, Ins. Planej., Ins. Remanej. e Refletido são opcionais. Quando o valor aprovado estiver vazio, o sistema preserva o valor anterior do aditivo; em um aditivo novo, usa Vlr_estimado. As classificações feitas no dashboard NÃO são apagadas ao recarregar.\n\nVeja a aba "ℹ️ Manual" para detalhes completos.',
  gestoes:
    '📅 ABA Gestões\n\nExporte da planilha:\n1. Abra o arquivo .xlsm\n2. Vá na aba Gestões\n3. Arquivo → Salvar Como → CSV UTF-8 (.csv)\n4. Carregue aqui\n\nCabeçalhos obrigatórios: Descr_gestao, Descr_classificacaofinanceira, Key_planejamento, Val_totalliquido e Mes_pagamento.\n\nVeja a aba "ℹ️ Manual" para detalhes completos.',
});
