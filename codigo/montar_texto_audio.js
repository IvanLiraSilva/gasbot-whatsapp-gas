// Node: Montar texto do áudio  (Code, "Run Once for All Items")
// Entrada: resposta do Whisper. Saída: os mesmos campos do "Normalizar Mensagem",
// com mensagem_cliente = texto do áudio.

const original = $('Normalizar Mensagem').first().json;
const resultado = $input.first().json;

// O Whisper devolve { text: "..." }. O n8n às vezes entrega essa resposta como texto
// dentro de "data" (JSON escrito em string); nesse caso lemos o JSON e pegamos só o "text".
function extrairTextoWhisper(resultado) {
  if (typeof resultado.text === "string") {
    return resultado.text;
  }

  const dados = resultado.data;

  if (dados && typeof dados === "object") {
    return String(dados.text ?? "");
  }

  if (typeof dados === "string") {
    if (dados.trim().startsWith("{")) {
      try {
        return String(JSON.parse(dados).text ?? "");
      } catch (erro) {
        // não era JSON de verdade: usa como veio
      }
    }

    return dados;
  }

  return "";
}

const bruto = extrairTextoWhisper(resultado);

// Converte formas faladas em P13 / P45
function normalizarFalaPedido(texto) {
  return String(texto || "")
    .replace(/\bp[êe]?[\s\-]*(?:13|treze)\b/gi, "P13")
    .replace(/\bp[êe]?[\s\-]*(?:45|quarenta e cinco)\b/gi, "P45")
    .replace(/\b(?:13|treze)\s*(?:quilos?|kilos?|kg)\b/gi, "P13")
    .replace(/\b(?:45|quarenta e cinco)\s*(?:quilos?|kilos?|kg)\b/gi, "P45")
    .replace(/\b(?:pics|piks|picks|piques?|pixe|piquis|pi x|p[êe] i xis)\b/gi, "Pix")
    .replace(/\s+/g, " ")
    .trim();
}

return [{
  json: {
    ...original,
    mensagem_cliente: normalizarFalaPedido(bruto),
    veio_de_audio: true
  }
}];
