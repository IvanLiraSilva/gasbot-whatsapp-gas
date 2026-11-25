const d = $json;

// Chave Pix. Para mudar, edite aqui (e também no node "Processar etapa Atendimento").
const chavePix = "(00)90000-0000";

function dinheiro(valor) {
  return Number(valor || 0).toFixed(2).replace(".", ",");
}

const nome = String(d.nome || "").trim();
const endereco = String(d.endereco || "").trim();

let novaEtapa = "";
let resposta = "";

if (nome && endereco) {
  // NOVO: sempre mostra o pedido completo (antes, só mostrava nome e endereço)
  novaEtapa = "CONFIRMAR_PEDIDO";

  const abertura =
    d.motivo_calculo === "CORRECAO"
      ? `Pronto, atualizei seu pedido! 😊\n\n`
      : `Perfeito, ${nome}! Confira seu pedido:\n\n`;

  const linhaPix =
    String(d.pagamento || "").toUpperCase() === "PIX" && chavePix
      ? `Chave Pix: ${chavePix}\n`
      : "";

  resposta =
    abertura +
    `Produto: ${d.produto}\n` +
    `Quantidade: ${d.quantidade}\n` +
    `Valor unitário: R$ ${dinheiro(d.valor_unitario)}\n` +
    `Valor total: R$ ${dinheiro(d.valor_total)}\n` +
    `Pagamento: ${d.pagamento}\n` +
    linhaPix +
    `Nome: ${nome}\n` +
    `Endereço: ${endereco}\n\n` +
    `Está tudo correto? Responda SIM para confirmar ou NÃO para corrigir.`;

} else {
  novaEtapa = "AGUARDANDO_NOME";
  resposta = "Perfeito! Para continuar, qual é o seu nome?";
}

return [{
  json: {
    ...d,
    etapa: novaEtapa,
    resposta
  }
}];
