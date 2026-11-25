const d = $json;
const agora = new Date();

const idAtendimento =
  "ATD-" +
  agora.getFullYear() +
  String(agora.getMonth() + 1).padStart(2, "0") +
  String(agora.getDate()).padStart(2, "0") +
  "-" +
  String(agora.getTime()).slice(-6);

let etapa = "";
let proximaPergunta = "";

let nomeAnterior = "";
let enderecoAnterior = "";

// ============================================
// BUSCAR DADOS DO CLIENTE ANTERIOR
// ============================================

try {
  const anterior = $('Selecionar Atendimento Atual').first().json;

  nomeAnterior = String(anterior.Nome || "").trim();
  enderecoAnterior = String(anterior.Endereco || "").trim();

} catch (e) {
  // Cliente novo, sem histórico
}


// ============================================
// COPIAR NOME E ENDEREÇO PARA O NOVO ATENDIMENTO
// ============================================

if (nomeAnterior) {
  d.nome = nomeAnterior;
}

if (enderecoAnterior) {
  d.endereco = enderecoAnterior;
}


// ============================================
// REFORÇO: LER O PEDIDO DIRETO DA MENSAGEM
// ============================================
// Se o interpretador não marcou o produto ou a quantidade, tenta de novo
// pelo texto: "gás de cozinha", "gás normal", "botijão comum" = P13.

let textoPedido = "";

try {
  const original = $('Normalizar Mensagem').first().json;
  textoPedido = String(original.mensagem_cliente || "");

  if (original.tipo_mensagem === "audioMessage") {
    textoPedido = String($('Montar texto do áudio').first().json.mensagem_cliente || textoPedido);
  }
} catch (e) {
  // sem texto: segue com o que já veio
}

const textoSemAcento = textoPedido
  .toLowerCase()
  .normalize("NFD")
  .replace(/[̀-ͯ]/g, "");

if (!d.produto) {
  if (/\bp[\s-]?45\b/.test(textoSemAcento)) {
    d.produto = "P45";
  } else if (
    /\bp[\s-]?13\b/.test(textoSemAcento) ||
    /\b(ga[sz]|botijao|bujao)\s+(de\s+cozinha|normal|comum|residencial|domestico|padrao)\b/.test(textoSemAcento)
  ) {
    d.produto = "P13";
  }
}

if (!d.quantidade) {
  const porExtenso = { um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10 };
  // o "13" de "P13" e o "45" de "P45" não são quantidade
  const textoParaQuantidade = textoSemAcento
    .replace(/\bp[\s-]?(13|45)\b/g, " ")
    .replace(/\b(13|45)\s?(kg|quilos?)\b/g, " ");
  const digitado = textoParaQuantidade.match(/\b(\d{1,2})\b/);

  if (digitado && Number(digitado[1]) > 0 && Number(digitado[1]) <= 50) {
    d.quantidade = Number(digitado[1]);
  } else {
    for (const [palavra, numero] of Object.entries(porExtenso)) {
      if (new RegExp("\\b" + palavra + "\\b").test(textoSemAcento)) {
        d.quantidade = numero;
        break;
      }
    }
  }
}

// ============================================
// DEFINIR PRÓXIMA ETAPA
// ============================================

// NOVO: cliente sem cadastro (primeiro atendimento) informa nome e endereço
// antes de qualquer pergunta do pedido. O que ele já disse (produto,
// quantidade, pagamento) continua salvo e é retomado depois.
const temCadastro = Boolean(nomeAnterior && enderecoAnterior);

if (!temCadastro) {

  etapa = "AGUARDANDO_NOME";

  proximaPergunta =
    "Olá! 😊 Para começar, qual é o seu nome?";
}

else if (!d.produto) {

  etapa = "AGUARDANDO_PRODUTO";

  proximaPergunta =
    "Qual botijão você deseja?";
}

else if (!d.quantidade) {

  etapa = "AGUARDANDO_QUANTIDADE";

  proximaPergunta =
    "Quantos botijões você deseja?";
}

else if (!d.pagamento) {

  etapa = "AGUARDANDO_PAGAMENTO";

  proximaPergunta =
    "Como deseja pagar? Pode ser Pix, cartão, dinheiro ou notinha.";
}

else {

  etapa = "CONFIRMAR_DADOS";

  proximaPergunta =
    `Encontrei seus dados anteriores:\n\n` +
    `Nome: ${nomeAnterior}\n` +
    `Endereço: ${enderecoAnterior}\n\n` +
    `Posso usar esses dados para esta entrega? Responda SIM ou NÃO.`;
}


// NOVO: cliente que já tem cadastro (2º pedido em diante) recebe um aviso amigável
// antes da primeira pergunta.
if (temCadastro) {
  proximaPergunta =
    `Olá, ${nomeAnterior}! 😊 Só um instante, já vamos prosseguir com seu atendimento.\n\n` +
    proximaPergunta;
}

// Registra a conversa como ativa (usado pelo "Filtro antes da planilha")
const registro = $getWorkflowStaticData('global');
registro.ativos = registro.ativos || {};

// mesma chave usada no filtro (ignora o "9" extra do celular)
function chaveTelefone(telefone) {
  const digitos = String(telefone || "").replace(/\D/g, "");
  const semPais = digitos.startsWith("55") && digitos.length >= 12 ? digitos.slice(2) : digitos;

  return semPais.length >= 10 ? semPais.slice(0, 2) + semPais.slice(-8) : digitos;
}

const normalizada = $('Normalizar Mensagem').first().json;
const chaveNova = chaveTelefone(normalizada.telefone || normalizada.Telefone);

if (chaveNova) {
  registro.ativos[chaveNova] = Date.now();
}

// ============================================
// RETORNO
// ============================================

return [{
  json: {
    ...d,

    etapa,

    nome: d.nome || "",
    endereco: d.endereco || "",

    id_atendimento: idAtendimento,

    proxima_pergunta: proximaPergunta
  }
}];
