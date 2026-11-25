const dados = JSON.parse($json.message.content);

// NOVO: se a mensagem veio em áudio, usa o texto transcrito
const normalizada = $('Normalizar Mensagem').first().json;
let textoMensagem = normalizada.mensagem_cliente;

if (normalizada.tipo_mensagem === "audioMessage") {
  try {
    textoMensagem = $('Montar texto do áudio').first().json.mensagem_cliente;
  } catch (erro) {
    // o áudio não foi transcrito: segue sem texto
  }
}

const mensagem = String(textoMensagem || "").toLowerCase().trim();


// ============================================
// QUANTIDADE
// ============================================

const numerosPorExtenso = {
  "um": 1,
  "uma": 1,
  "dois": 2,
  "duas": 2,
  "três": 3,
  "tres": 3,
  "quatro": 4,
  "cinco": 5,
  "seis": 6,
  "sete": 7,
  "oito": 8,
  "nove": 9,
  "dez": 10
};

// o "13" de "P13" e o "45" de "P45" não são quantidade
const mensagemParaQuantidade = mensagem
  .replace(/\bp[\s-]?(13|45)\b/g, " ")
  .replace(/\b(13|45)\s?(kg|quilos?)\b/g, " ");

const numeroDigitado = mensagemParaQuantidade.match(/\b(\d+)\b/);

let quantidade = null;

if (numeroDigitado) {
  quantidade = Number(numeroDigitado[1]);
}
else {
  for (const [palavra, numero] of Object.entries(numerosPorExtenso)) {

    const regex = new RegExp(`\\b${palavra}\\b`, "i");

    if (regex.test(mensagem)) {
      quantidade = numero;
      break;
    }
  }
}

if (!quantidade || quantidade <= 0) {
  quantidade = null;
}


// ============================================
// PRODUTO
// ============================================

let produto = null;

const mencionouP45 = /\bp[\s-]?45\b/i.test(mensagem);
// NOVO: "gás normal", "gás de cozinha", "botijão comum"... é o P13
const mensagemSemAcento = mensagem.normalize("NFD").replace(/[̀-ͯ]/g, "");
const mencionouP13 =
  /\bp[\s-]?13\b/i.test(mensagem) ||
  /\b(ga[sz]|botijao|bujao)\s+(de\s+cozinha|normal|comum|residencial|domestico|padrao)\b/.test(mensagemSemAcento);

// P45
if (mencionouP45) {
  produto = "P45";
}

// P13
else if (mencionouP13) {
  produto = "P13";
}

// Outro modelo informado: P20, P30, P40 etc.
// Não aceitar como P13.
else if (/\bp\d+\b/i.test(mensagem)) {
  produto = null;
}

// Nenhum modelo informado.
// Ex.: "quero gás", "preciso de gás", "manda um gás"
// NÃO assumir P13.
else {
  produto = null;
}


// ============================================
// PAGAMENTO
// ============================================

let pagamento = null;

if (/\bpix\b/i.test(mensagem)) {
  pagamento = "PIX";
}
else if (/\bdinheiro\b/i.test(mensagem)) {
  pagamento = "DINHEIRO";
}
else if (
  /\bcartão\b/i.test(mensagem) ||
  /\bcartao\b/i.test(mensagem) ||
  /\bcrédito\b/i.test(mensagem) ||
  /\bcredito\b/i.test(mensagem) ||
  /\bdébito\b/i.test(mensagem) ||
  /\bdebito\b/i.test(mensagem)
) {
  pagamento = "CARTAO";
}
else if (
  /\bnotinha\b/i.test(mensagem) ||
  /\ba prazo\b/i.test(mensagem)
) {
  pagamento = "NOTINHA";
}


// ============================================
// INTENÇÃO
// ============================================

const intencao = dados.intencao || null;


// ============================================
// RETORNO
// ============================================

return [
  {
    json: {
      intencao,
      produto,
      quantidade,
      pagamento
    }
  }
];
