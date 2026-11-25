// Node: Preparar Voz  (Code, "Run Once for Each Item")
// Entrada: a saída de QUALQUER node que acabou de enviar texto pela Evolution API.
// A resposta da Evolution traz o texto enviado em message.conversation.

const enviado = $json.message || {};

let resposta = String(enviado.conversation || enviado.extendedTextMessage?.text || "");

// Plano B, se a resposta da Evolution não trouxer o texto
if (!resposta) {
  try {
    resposta = String($('Processar etapa Atendimento').item.json.resposta || "");
  } catch (e) {
    // segue
  }
}

if (!resposta) {
  try {
    resposta = String($('Definir Etapa Inicial').item.json.proxima_pergunta || "");
  } catch (e) {
    // segue
  }
}

const veioDeAudio = $('Normalizar Mensagem').first().json.tipo_mensagem === "audioMessage";

// ---------- ajustes para a voz falar de forma natural ----------

const digitos = ["zero", "um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove"];

function digitosPorExtenso(numero) {
  return String(numero).split("").map(d => digitos[Number(d)]).join(" ");
}

function textoParaFala(texto) {
  return String(texto || "")
    // não lê o eco "Entendi: ..." da transcrição
    .replace(/Entendi: ".*?"\s*/s, "")
    // emojis
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}️]/gu, "")
    // telefone / chave Pix: fala dígito por dígito, em grupos
    .replace(/\(?(\d{2})\)?\s?(\d{4,5})-?(\d{4})/g, (_, ddd, meio, fim) =>
      digitosPorExtenso(ddd) + ", " + digitosPorExtenso(meio) + ", " + digitosPorExtenso(fim))
    // dinheiro: R$ 200,00 -> 200 reais ; R$ 20,50 -> 20 reais e 50 centavos
    .replace(/R\$\s*(\d+),(\d{2})/g, (_, reais, centavos) =>
      centavos === "00" ? reais + " reais" : reais + " reais e " + centavos + " centavos")
    .replace(/R\$\s*(\d+)/g, "$1 reais")
    // produtos e palavras que a voz lê errado
    .replace(/\bP13\b/gi, "pê treze")
    .replace(/\bP45\b/gi, "pê quarenta e cinco")
    .replace(/\bpix\b/gi, "pics")
    .replace(/\bValor unitário\b/gi, "Valor de cada botijão")
    // abreviações de endereço
    .replace(/\bAv\.?(?=\s)/g, "Avenida")
    .replace(/\bapto\.?/gi, "apartamento")
    .replace(/\bs\/n\b/gi, "sem número")
    // palavras em maiúsculas (SIM, NÃO) viram minúsculas, senão a voz soletra
    .replace(/\b[A-ZÁÉÍÓÚÂÊÔÃÕÇ]{2,}\b/g, p => p.toLowerCase())
    // pontuação: tom calmo, sem gritar
    .replace(/!/g, ".")
    .replace(/\s*\(/g, ", ").replace(/\)/g, "")
    .replace(/\s*\n+\s*/g, ". ")
    .replace(/:/g, ",")
    .replace(/([.,?])\s*[.,]/g, "$1")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 800);
}

const texto = textoParaFala(resposta);

return {
  json: {
    falar: veioDeAudio && texto.length > 0,
    texto_voz: texto,
    // para quem enviar o áudio (vem da própria resposta da Evolution)
    numero: $json.key?.remoteJid || ""
  }
};
