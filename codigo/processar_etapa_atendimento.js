const atendimento = $('Selecionar Atendimento Atual').first().json;

// Registro das conversas em andamento (usado pelo "Filtro antes da planilha")
const registro = $getWorkflowStaticData('global');
registro.ativos = registro.ativos || {};

// mesma chave usada no filtro (ignora o "9" extra do celular)
function chaveTelefone(telefone) {
  const digitos = String(telefone || "").replace(/\D/g, "");
  const semPais = digitos.startsWith("55") && digitos.length >= 12 ? digitos.slice(2) : digitos;

  return semPais.length >= 10 ? semPais.slice(0, 2) + semPais.slice(-8) : digitos;
}

function marcarConversa(telefone, ativa) {
  const chave = chaveTelefone(telefone);

  if (!chave) {
    return;
  }

  if (ativa) {
    registro.ativos[chave] = Date.now();
  } else {
    delete registro.ativos[chave];
  }
}

// Configurações do negócio. Ficam aqui no código para não consultar a planilha a cada mensagem.
// Para mudar a chave Pix, edite abaixo (e também no node "Após Calcular Preço").
const configuracoes = {
  "Empresa": "Distribuidora Exemplo",
  "Chave Pix": "(00)90000-0000",
  "Tempo mínimo": "20",
  "Tempo máximo": "40",
  "Mensagem final": "Obrigado pela preferência!"
};

const chavePix = configuracoes["Chave Pix"] || "";

const editFields1 = $('Normalizar Mensagem').first().json;

// NOVO: se a mensagem veio em áudio, usa o texto transcrito
let textoMensagem = editFields1.mensagem_cliente;

if (editFields1.tipo_mensagem === "audioMessage") {
  try {
    textoMensagem = $('Montar texto do áudio').first().json.mensagem_cliente;
  } catch (erro) {
    // o áudio não foi transcrito (ex.: longo demais): segue sem texto
  }
}

const mensagem = String(textoMensagem || "").trim();
const mensagemLower = mensagem.toLowerCase();

const mensagemNormalizada = mensagemLower
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .trim();

const etapa = String(atendimento.Etapa || "").trim();

const comprovanteRecebido =
  editFields1.comprovante_recebido === true ||
  String(editFields1.comprovante_recebido).toLowerCase() === "true";

const parecePedido =
  /\b(quero|preciso|manda|mandar|ga[sz]|botijao|bujao|p13|p45|pix|cartao|dinheiro|notinha)\b/i.test(mensagemNormalizada) ||
  /\bp\d+\b/i.test(mensagemNormalizada);

let novaEtapa = etapa;
let nome = String(atendimento.Nome || "").trim();
let endereco = String(atendimento.Endereco || "").trim();
let produto = String(atendimento.Produto || "").trim();
let quantidade = atendimento.Quantidade || "";
let pagamento = String(atendimento.Pagamento || "").trim().toUpperCase();

let valorUnitario = Number(atendimento.ValorUnitario || 0);
let valorTotal = Number(atendimento.ValorTotal || 0);

// NOVO: valor da nota que o cliente vai pagar quando precisa de troco (vazio = sem troco)
let troco = atendimento.Troco ? Number(String(atendimento.Troco).replace(",", ".")) || "" : "";

let resposta = "";
let novoAtendimento = false;
let idAtendimentoFinal = atendimento.IDAtendimento;
let rowNumberFinal = atendimento.row_number;

// Indica aos próximos nodes que o preço está sendo recalculado
// por causa de uma correção do cliente.
let motivoCalculo = "";

// ======================================================
// FUNÇÕES AUXILIARES
// ======================================================

// NOVO: limite de segurança. Números acima disso não são aceitos como quantidade
// (ex.: o 123 de um endereço). Ajuste se vender em volume maior.
const QUANTIDADE_MAXIMA = 50;

function normalizar(texto) {
  return String(texto || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

// NOVO: entende SIM / NÃO mesmo com pontuação ou frase ("Sim.", "Não, obrigado", "Isso mesmo").
// A transcrição de áudio sempre vem com ponto final, então a comparação exata não servia.
function interpretarSimNao(texto) {
  const t = normalizar(texto).replace(/[^a-z\s]/g, " ").replace(/\s+/g, " ").trim();

  if (!t) {
    return null;
  }

  const primeira = t.split(" ")[0];

  if (primeira === "nao" || primeira === "n") {
    return "NAO";
  }

  if (["sim", "s", "ok", "certo", "correto", "confirmo", "confirmado", "positivo", "claro", "beleza", "blz", "uhum", "aham"].includes(primeira)) {
    return "SIM";
  }

  if (/\b(nao|errado|incorreto)\b/.test(t)) {
    return "NAO";
  }

  if (/\b(sim|correto|confirmo|isso mesmo|pode usar|tudo certo)\b/.test(t)) {
    return "SIM";
  }

  return null;
}

function extrairQuantidade(texto) {
  // CORRIGIDO: o "13" de "P13" / "P 13" / "13 kg" e o "45" de "P45" não são quantidade
  const t = normalizar(texto)
    .replace(/\bp[\s-]?(13|45)\b/g, " ")
    .replace(/\b(13|45)\s?(kg|quilos?)\b/g, " ");

  const numerosPorExtenso = {
    um: 1,
    uma: 1,
    dois: 2,
    duas: 2,
    tres: 3,
    quatro: 4,
    cinco: 5,
    seis: 6,
    sete: 7,
    oito: 8,
    nove: 9,
    dez: 10
  };

  const numeroDigitado = t.match(/\b(\d+)\b/);

  if (numeroDigitado) {
    const n = Number(numeroDigitado[1]);
    return n > 0 && n <= QUANTIDADE_MAXIMA ? n : null;
  }

  for (const [palavra, numero] of Object.entries(numerosPorExtenso)) {
    const regex = new RegExp("\\b" + palavra + "\\b", "i");

    if (regex.test(t)) {
      return numero;
    }
  }

  return null;
}

function extrairPagamento(texto) {
  const t = normalizar(texto);

  if (/\bpix\b/.test(t)) {
    return "PIX";
  }

  if (
    t.includes("cartao") ||
    t.includes("credito") ||
    t.includes("debito")
  ) {
    return "CARTAO";
  }

  if (t.includes("dinheiro")) {
    return "DINHEIRO";
  }

  if (
    t.includes("notinha") ||
    t.includes("a prazo") ||
    t.includes("prazo") ||
    t.includes("fiado")
  ) {
    return "NOTINHA";
  }

  return null;
}

function extrairProduto(texto) {
  const t = normalizar(texto);

  // CORRIGIDO: aceita "P13", "P 13" e "P-13"
  if (/\bp[\s-]?45\b/.test(t)) {
    return "P45";
  }

  if (/\bp[\s-]?13\b/.test(t)) {
    return "P13";
  }

  // NOVO: "gás normal", "gás de cozinha", "botijão comum"... é o P13
  if (/\b(ga[sz]|botijao|bujao)\s+(de\s+cozinha|normal|comum|residencial|domestico|padrao)\b/.test(t)) {
    return "P13";
  }

  return null;
}

// NOVO: usado só quando o bot acabou de perguntar o modelo ("P13 ou P45?").
// Aí o cliente pode responder só "normal", "comum", "de cozinha"... e isso é o P13.
function extrairProdutoPerguntado(texto) {
  const direto = extrairProduto(texto);

  if (direto) {
    return direto;
  }

  const t = normalizar(texto);

  if (/\b(normal|comum|de cozinha|cozinha|residencial|domestico|padrao)\b/.test(t)) {
    return "P13";
  }

  return null;
}

// NOVO: aviso amigável ao começar um novo pedido de quem já é cliente
function saudacaoNovoPedido() {
  return nome
    ? "Claro, " + nome + "! 😊 Só um instante, já vamos prosseguir com seu novo pedido.\n\n"
    : "Claro! 😊 ";
}

// NOVO: começa um novo pedido aproveitando o que o cliente já disse
// ("quero outro gás normal", "mais 2 de cozinha") e só pergunta o que falta.
function prepararNovoPedido(texto, comSaudacao = true) {
  produto = extrairProdutoPerguntado(normalizar(texto)) || "";
  quantidade = extrairQuantidade(texto) || "";
  pagamento = "";
  valorUnitario = 0;
  valorTotal = 0;
  troco = "";

  // Respondeu SIM em "Deseja mais alguma coisa?": só "Claro!", sem o aviso com o nome
  const abertura = comSaudacao ? saudacaoNovoPedido() : "Claro! 😊 ";

  if (!produto) {
    novaEtapa = "AGUARDANDO_PRODUTO";
    resposta =
      abertura +
      "Você deseja P13 (o gás de cozinha normal) ou P45?" +
      (quantidade ? "" : " E quantos botijões?");
  } else if (!quantidade) {
    novaEtapa = "AGUARDANDO_QUANTIDADE";
    resposta = abertura + "Quantos botijões você deseja?";
  } else {
    novaEtapa = "AGUARDANDO_PAGAMENTO";
    resposta =
      abertura +
      "Como deseja realizar o pagamento? Pix, dinheiro, cartão ou notinha?";
  }
}

// NOVO: cliente desistiu / respondeu SIM por engano ("não quero mais nada", "foi engano").
// Só vale quando a mensagem não traz produto nem quantidade ("P13, nada de P45" não cancela).
function cancelouAtendimento(texto) {
  const t = normalizar(texto).replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();

  // Se falou produto, quantidade ou pagamento, está pedindo (não desistindo)
  if (!t || extrairProdutoPerguntado(t) || extrairQuantidade(texto) || extrairPagamento(texto)) {
    return false;
  }

  // "não sei qual", "não lembro": o cliente tem dúvida, não desistiu
  if (/\bnao (sei|lembro|entendi|conheco|tenho certeza)\b/.test(t)) {
    return false;
  }

  // "não quero esse, quero outro": ainda quer comprar
  const semNegativa = t.replace(/\bnao (quero|vou querer|preciso)\b/g, " ");

  if (/\b(quero|preciso|manda|mandar|outro|outra|troca|trocar)\b/.test(semNegativa)) {
    return false;
  }

  return (
    /^(nao|n)$/.test(t) ||
    /\b(nada|nenhum|nenhuma|engano|enganado|errado|errei|desisti|desistir|cancela|cancelar|cancelado|sem querer|deixa pra la|esquece|so isso|mais nada|por hoje|agora nao|por enquanto nao|pode encerrar|encerrar|encerra)\b/.test(t) ||
    /\bnao (quero|vou querer|preciso|precisa|obrigado|obrigada|e isso|e nada)\b/.test(t) ||
    /^(obrigado|obrigada|valeu)\b/.test(t)
  );
}

function temModeloNaoDisponivel(texto) {
  const t = normalizar(texto);
  const match = t.match(/\bp(\d+)\b/);

  if (!match) {
    return false;
  }

  return match[1] !== "13" && match[1] !== "45";
}

function gerarIdAtendimento() {
  const agora = new Date();

  const yyyy = agora.getFullYear();
  const mm = String(agora.getMonth() + 1).padStart(2, "0");
  const dd = String(agora.getDate()).padStart(2, "0");

  const aleatorio = String(
    Math.floor(100000 + Math.random() * 900000)
  );

  return "ATD-" + yyyy + mm + dd + "-" + aleatorio;
}

function formatarValor(valor) {
  return Number(valor || 0).toFixed(2).replace(".", ",");
}

// NOVO: troco. Descobre "para quanto" a partir de números ("100", "R$ 50,00") ou palavras ("cem").
function extrairValorTroco(texto) {
  const t = normalizar(texto);

  // CORRIGIDO: entende "10.500", "10.500,00", "11.000,00", "10500", "50,50", "R$ 100"
  const digitado = t.match(
    /\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+\.\d{1,2}(?!\d)|\d+(?:,\d{1,2})?/
  );

  if (digitado) {
    const bruto = digitado[0];
    const numero = /^\d{1,3}(?:\.\d{3})+/.test(bruto)
      ? bruto.replace(/\./g, "").replace(",", ".")   // ponto = milhar
      : bruto.replace(",", ".");                       // vírgula ou ponto = centavos

    return Number(numero);
  }

  const porExtenso = {
    dez: 10, vinte: 20, trinta: 30, quarenta: 40, cinquenta: 50, sessenta: 60,
    setenta: 70, oitenta: 80, noventa: 90, cem: 100, cento: 100,
    duzentos: 200, trezentos: 300, quatrocentos: 400, quinhentos: 500
  };

  // Soma as palavras achadas: "duzentos e cinquenta" = 200 + 50
  let soma = 0;

  for (const [palavra, numero] of Object.entries(porExtenso)) {
    if (new RegExp("\\b" + palavra + "\\b").test(t)) {
      soma += numero;
    }
  }

  return soma > 0 ? soma : null;
}

function disseSemTroco(texto) {
  const t = normalizar(texto).replace(/[^a-z\s]/g, " ").replace(/\s+/g, " ").trim();

  return (
    /\b(sem troco|nao preciso|nao precisa|nao vou precisar|nao tem problema|tenho trocado|trocado|certinho|valor certo|valor exato|exato)\b/.test(t) ||
    interpretarSimNao(texto) === "NAO"
  );
}

// NOVO: resumo final, depois que o cliente informou o troco
function resumoFinalPedido() {
  return (
    "Pedido confirmado! 😊\n\n" +
    "Produto: " + produto + "\n" +
    "Quantidade: " + quantidade + "\n" +
    "Valor total: R$ " + formatarValor(valorTotal) + "\n" +
    "Pagamento: " + pagamento + "\n" +
    (troco
      ? "Troco para: R$ " + formatarValor(troco) +
        " (levar R$ " + formatarValor(troco - valorTotal) + " de troco)\n"
      : "Troco: não precisa\n") +
    "Nome: " + nome + "\n" +
    "Endereço: " + endereco + "\n\n" +
    "Seu pedido será encaminhado para entrega."
  );
}

function resumoPedido() {
  return (
    "Perfeito, " + (nome || "cliente") + "! Confira seu pedido:\n\n" +
    "Produto: " + produto + "\n" +
    "Quantidade: " + quantidade + "\n" +
    "Valor unitário: R$ " + formatarValor(valorUnitario) + "\n" +
    "Valor total: R$ " + formatarValor(valorTotal) + "\n" +
    "Pagamento: " + pagamento + "\n" +
    (pagamento === "PIX" && chavePix ? "Chave Pix: " + chavePix + "\n" : "") +
    "Nome: " + nome + "\n" +
    "Endereço: " + endereco + "\n\n" +
    "Está tudo correto? Responda SIM para confirmar ou NÃO para corrigir."
  );
}

// NOVO: acha onde o endereço começa ("Rua", "Av", "Travessa"...) no texto já normalizado.
function acharInicioEndereco(t) {
  return t.search(
    /\b(rua|r\.|av\.?|avenida|travessa|alameda|estrada|rodovia|praca|quadra|lote|vila|beco|conjunto|residencial|condominio|sitio|chacara|fazenda)(?=[\s.])/
  );
}

// NOVO: diz se o texto (já normalizado) fala de produto, quantidade ou pagamento.
function pareceTextoDePedido(t) {
  return (
    /\b(p13|p45|pix|dinheiro|cartao|credito|debito|notinha|prazo|fiado|botijao|botijoes|bujao|bujoes|ga[sz]|unidades?|quero|preciso|manda|mandar)\b/.test(t) ||
    /\bp\d+\b/.test(t)
  );
}

// NOVO: se depois do endereço vier pedido junto ("Rua A, 12, 1 botijão p45, pix"),
// corta o endereço antes do pedido e devolve o pedido em "resto".
function cortarPedidoDoEndereco(texto) {
  const original = String(texto || "").trim();
  const t = normalizar(original);

  if (t.length !== original.length) {
    return { endereco: original, resto: "" };
  }

  const corte = t.search(
    /\b\d+\s*(?:botijao|botijoes|bujao|bujoes|ga[sz]|unidades?)\b|\b(?:p13|p45|pix|dinheiro|cartao|credito|debito|notinha|fiado|quero|preciso|manda|mandar)\b/
  );

  if (corte <= 0) {
    return { endereco: original, resto: "" };
  }

  return {
    endereco: original.slice(0, corte).replace(/[\s,;\-]+$/, "").trim(),
    resto: original.slice(corte).trim()
  };
}

// NOVO: separa nome, endereço e pedido quando o cliente manda tudo na mesma mensagem.
// Classifica cada linha pelo conteúdo (não pela posição):
//   - tem "Rua", "Av", "Travessa"...  -> endereço
//   - tem produto, quantidade ou pagamento -> pedido (volta em "resto")
//   - só letras, sem número -> nome
// Também aceita "nome: João, endereço: Rua A, 12".
// Retorna { nome, endereco, resto } (qualquer um pode vir vazio) ou null quando
// não achou nem nome nem endereço.
function extrairNomeEEndereco(texto) {
  const original = String(texto || "").trim();

  if (!original) {
    return null;
  }

  const t = normalizar(original);
  const alinhado = t.length === original.length;
  const temNome = /\bnome\b/.test(t);
  const temEndereco = /\bendereco\b/.test(t);

  // 0) NOVO: vários campos com rótulo na mesma mensagem, por exemplo
  // "quantidade 5 e endereço Rua A, 12" ou "endereço: dancador estrela, 197, pagamento pix".
  // Cada campo vai até o próximo rótulo; nome e endereço ficam separados do resto.
  if (alinhado && (temNome || temEndereco)) {
    const rotulos = [];
    const regexRotulo = /\b(nome|endereco|quantidade|qtd|produto|modelo|pagamento)\b/g;
    let achado;

    while ((achado = regexRotulo.exec(t)) !== null) {
      rotulos.push({ palavra: achado[1], inicio: achado.index, fim: achado.index + achado[1].length });
    }

    const temOutroCampo = rotulos.some(r => !["nome", "endereco"].includes(r.palavra));

    if (temOutroCampo) {
      let nomeRot = "";
      let enderecoRot = "";
      const restoRot = [];

      rotulos.forEach((r, i) => {
        const limite = i + 1 < rotulos.length ? rotulos[i + 1].inicio : original.length;

        const valor = original
          .slice(r.fim, limite)
          .replace(/^\s*(?:[:\-]|é|eh|e)?\s*/i, "")
          .replace(/^(?:o|a|do|da|de)\s+/i, "")
          .replace(/[\s,;.\-]+(?:e\s+)?(?:o\s+|a\s+)?$/i, "")
          .trim();

        if (!valor) {
          return;
        }

        if (r.palavra === "nome") {
          nomeRot = valor;
        } else if (r.palavra === "endereco") {
          enderecoRot = valor;
        } else {
          restoRot.push(r.palavra + " " + valor);
        }
      });

      if (nomeRot || enderecoRot || restoRot.length) {
        return { nome: nomeRot, endereco: enderecoRot, resto: restoRot.join(", ") };
      }
    }
  }

  // 1) Com rótulos: "nome: João Silva, endereço: Rua A, 12" (ou o contrário)
  if (temNome && temEndereco) {
    const nomeDepois = original.match(
      /nome\s*(?:[:\-]|é|eh)?\s*(.+?)[\s,;.\-]+(?:e\s+)?(?:o\s+)?endere[cç]o\s*(?:[:\-]|é|eh)?\s*(.+)$/is
    );

    if (nomeDepois) {
      return { nome: nomeDepois[1].trim(), endereco: nomeDepois[2].trim(), resto: "" };
    }

    const enderecoDepois = original.match(
      /endere[cç]o\s*(?:[:\-]|é|eh)?\s*(.+?)[\s,;.\-]+(?:e\s+)?(?:o\s+)?nome\s*(?:[:\-]|é|eh)?\s*(.+)$/is
    );

    if (enderecoDepois) {
      return { nome: enderecoDepois[2].trim(), endereco: enderecoDepois[1].trim(), resto: "" };
    }

    return null;
  }

  // 2) Citou só "endereço": pega a partir de onde começa a rua, se houver
  if (temEndereco) {
    const inicio = alinhado ? acharInicioEndereco(t) : -1;

    if (inicio >= 0) {
      const partes = cortarPedidoDoEndereco(original.slice(inicio));

      // NOVO: o que vem antes do endereço ("3 botijões, endereço Rua A") também conta
      const antes = original
        .slice(0, inicio)
        .replace(/endere[cç]o\s*(?:[:\-]|é|eh)?\s*$/i, "")
        .replace(/[\s,;.\-]+(?:e\s+)?(?:o\s+|a\s+)?$/i, "")
        .trim();

      const restoTotal = [
        /\d/.test(antes) || pareceTextoDePedido(normalizar(antes)) ? antes : "",
        partes.resto
      ].filter(Boolean).join(", ");

      return { nome: "", endereco: partes.endereco, resto: restoTotal };
    }

    return null;
  }

  // Citou só "nome": deixa o fluxo normal perguntar
  if (temNome) {
    return null;
  }

  // 3) Linha por linha
  const linhas = original.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

  let nomeAchado = "";
  let enderecoAchado = "";
  const resto = [];

  for (const linha of linhas) {
    const tl = normalizar(linha);
    const inicio = tl.length === linha.length ? acharInicioEndereco(tl) : -1;

    // Linha com endereço (pode ter o nome antes e o pedido depois)
    if (inicio >= 0) {
      const antes = linha.slice(0, inicio).replace(/[\s,;\-]+$/, "").trim();
      const partes = cortarPedidoDoEndereco(linha.slice(inicio));

      // O que vem antes do endereço pode ter nome e pedido ("02 p45, João Silva")
      for (const pedaco of antes.split(/[,;]+/).map(p => p.trim()).filter(Boolean)) {
        if (/\d/.test(pedaco) || pareceTextoDePedido(normalizar(pedaco))) {
          resto.push(pedaco);
        } else if (!nomeAchado) {
          nomeAchado = pedaco;
        }
      }

      enderecoAchado = enderecoAchado
        ? enderecoAchado + ", " + partes.endereco
        : partes.endereco;

      if (partes.resto) {
        resto.push(partes.resto);
      }

      continue;
    }

    // Linha de pedido: produto, quantidade ou pagamento
    if (pareceTextoDePedido(tl)) {
      resto.push(linha);
      continue;
    }

    // Complemento do endereço ("apto 45", "123", "Bloco B")
    if (enderecoAchado) {
      enderecoAchado += ", " + linha;
      continue;
    }

    // Só letras, sem número: é o nome
    if (
      !nomeAchado &&
      linhas.length >= 2 &&
      !/\d/.test(linha) &&
      linha.split(/\s+/).length <= 6
    ) {
      nomeAchado = linha;
      continue;
    }

    resto.push(linha);
  }

  // Duas linhas sem "Rua"/"Av": a primeira é o nome e a segunda o endereço
  if (
    nomeAchado &&
    !enderecoAchado &&
    linhas.length === 2 &&
    resto.length === 1 &&
    !pareceTextoDePedido(normalizar(resto[0]))
  ) {
    enderecoAchado = resto[0];
    resto.length = 0;
  }

  if (!nomeAchado && !enderecoAchado) {
    return null;
  }

  return { nome: nomeAchado, endereco: enderecoAchado, resto: resto.join(" ") };
}

// NOVO: menu de correção, usado nas duas perguntas de confirmação
function menuCorrecao() {
  return (
    "Tudo bem! O que deseja corrigir?\n\n" +
    "1. Produto (P13 ou P45)\n" +
    "2. Quantidade\n" +
    "3. Pagamento\n" +
    "4. Nome\n" +
    "5. Endereço\n\n" +
    "Responda com o número da opção ou informe direto a alteração, por exemplo: P45, 2 botijões ou Pix."
  );
}

// CORRIGIDO: o motivo "CORRECAO" agora só é marcado quando a chamada
// vem de uma correção. No pedido normal (primeira vez) fica vazio.
function iniciarRecalculo(motivo = "") {
  valorUnitario = 0;
  valorTotal = 0;
  motivoCalculo = motivo;
  novaEtapa = "CALCULAR_PRECO";
  resposta = "";
}

function irParaConfirmacao() {
  novaEtapa = "CONFIRMAR_PEDIDO";
  resposta = resumoPedido();
}

// NOVO: depois que o cliente informa nome e endereço, segue com o que ainda falta
// do pedido (produto, quantidade, pagamento) ou vai direto ao resumo.
function continuarPedido() {
  if (!produto) {
    novaEtapa = "AGUARDANDO_PRODUTO";
    resposta =
      quantidade && Number(quantidade) > 0
        ? "Você deseja botijão P13 ou P45?"
        : "Você deseja botijão P13 ou P45? E quantos botijões?";
  } else if (!quantidade || Number(quantidade) <= 0) {
    novaEtapa = "AGUARDANDO_QUANTIDADE";
    resposta = "Quantos botijões você deseja?";
  } else if (!pagamento) {
    novaEtapa = "AGUARDANDO_PAGAMENTO";
    resposta =
      "Como deseja realizar o pagamento? Pix, dinheiro, cartão ou notinha?";
  } else if (!(valorTotal > 0)) {
    iniciarRecalculo();
  } else {
    irParaConfirmacao();
  }
}

// CORRIGIDO: aplica TODOS os valores que vierem na mensagem
// (ex.: "P45, 2 botijões" troca produto e quantidade) e recalcula uma vez só.
function interpretarCorrecaoDireta(texto = mensagem) {
  const textoNormalizado = normalizar(texto);

  if (temModeloNaoDisponivel(textoNormalizado) && !extrairProduto(textoNormalizado)) {
    novaEtapa = "AGUARDANDO_CORRECAO";
    resposta =
      "Trabalhamos com botijão P13 ou P45. Qual desses modelos você deseja?";
    return true;
  }

  const produtoNovo = extrairProduto(textoNormalizado);
  const pagamentoNovo = extrairPagamento(texto);
  const quantidadeNova = extrairQuantidade(texto);

  let mudou = false;

  if (produtoNovo) {
    produto = produtoNovo;
    mudou = true;
  }

  if (pagamentoNovo) {
    pagamento = pagamentoNovo;
    mudou = true;
  }

  if (quantidadeNova && quantidadeNova > 0) {
    quantidade = quantidadeNova;
    mudou = true;
  }

  if (mudou) {
    iniciarRecalculo("CORRECAO");
    return true;
  }

  return false;
}

// ======================================================
// FILA DE CORREÇÃO (cliente quer corrigir 2 ou mais itens: "quantidade e endereço")
// A etapa guarda o que ainda falta, ex.: "CORRIGIR_ENDERECO>QUANTIDADE".
// ======================================================

const etapaBase = etapa.split(">")[0];
const filaCorrecao = etapa.includes(">") ? etapa.split(">").slice(1) : [];

const perguntasCorrecao = {
  PRODUTO: "Qual produto deseja: P13 ou P45?",
  QUANTIDADE: "Qual é a nova quantidade desejada?",
  PAGAMENTO: "Qual será a forma de pagamento: Pix, dinheiro, cartão ou notinha?",
  NOME: "Certo. Informe o nome correto para este pedido.",
  ENDERECO: "Certo. Informe o endereço correto para a entrega."
};

// monta o nome da etapa com o que ainda falta corrigir
function etapaCorrecao(campo, fila) {
  return "CORRIGIR_" + campo + (fila.length ? ">" + fila.join(">") : "");
}

// o mesmo item de novo (resposta não entendida), mantendo o que falta
function repetirEtapaCorrecao(campo) {
  return etapaCorrecao(campo, filaCorrecao);
}

// se ainda falta corrigir algo, faz a próxima pergunta e devolve true
function seguirFilaCorrecao() {
  if (!filaCorrecao.length) {
    return false;
  }

  const [proximo, ...resto] = filaCorrecao;
  novaEtapa = etapaCorrecao(proximo, resto);
  resposta = "Anotado! ✅\n\n" + perguntasCorrecao[proximo];
  return true;
}

// descobre quais itens o cliente citou pelo nome ("quantidade e endereço")
function camposCitados(t) {
  const regras = [
    ["PRODUTO", /\b(produto|modelo)\b/],
    ["QUANTIDADE", /\b(quantidade|qtd|unidades|botijoes)\b/],
    ["PAGAMENTO", /\b(pagamento|pagar|forma)\b/],
    ["NOME", /\b(nome|cliente)\b/],
    ["ENDERECO", /\b(endereco|entrega|local)\b/]
  ];

  return regras
    .map(([campo, regex]) => ({ campo, pos: t.search(regex) }))
    .filter(c => c.pos >= 0)
    .sort((a, b) => a.pos - b.pos)
    .map(c => c.campo);
}

// nome e endereço primeiro; o que muda o preço (produto, quantidade, pagamento) por último,
// assim o recálculo acontece uma vez só, no fim.
function ordenarCampos(campos) {
  const semPreco = campos.filter(c => c === "NOME" || c === "ENDERECO");
  const comPreco = campos.filter(c => !(c === "NOME" || c === "ENDERECO"));
  return [...semPreco, ...comPreco];
}

// ======================================================
// 1. AGUARDANDO PRODUTO
// ======================================================

// NOVO: desistência durante as perguntas do pedido (inclusive o SIM por engano
// em "Deseja mais alguma coisa?") encerra o atendimento.
if (
  ["AGUARDANDO_PRODUTO", "AGUARDANDO_QUANTIDADE", "AGUARDANDO_PAGAMENTO"].includes(etapa) &&
  cancelouAtendimento(mensagem)
) {
  novaEtapa = "FINALIZADO";
  resposta =
    "Tudo bem, sem problema! 😊\n\n" +
    "Atendimento encerrado. Se precisar de gás, é só chamar.\n\n" +
    "A Distribuidora Exemplo está sempre à sua disposição!";
}

else if (etapa === "AGUARDANDO_PRODUTO") {
  const produtoNovo = extrairProdutoPerguntado(mensagemNormalizada);
  const quantidadeNova = extrairQuantidade(mensagem);
  const pagamentoNovo = extrairPagamento(mensagem);

  if (produtoNovo) {
    produto = produtoNovo;

    if (quantidadeNova && quantidadeNova > 0) {
      quantidade = quantidadeNova;
    }

    if (pagamentoNovo) {
      pagamento = pagamentoNovo;
    }

    if (!quantidade || Number(quantidade) <= 0) {
      novaEtapa = "AGUARDANDO_QUANTIDADE";
      resposta = "Quantos botijões você deseja?";
    } else if (!pagamento) {
      novaEtapa = "AGUARDANDO_PAGAMENTO";
      resposta =
        "Como deseja realizar o pagamento? Pix, dinheiro, cartão ou notinha?";
    } else {
      iniciarRecalculo();
    }
  } else if (temModeloNaoDisponivel(mensagemNormalizada)) {
    novaEtapa = "AGUARDANDO_PRODUTO";
    resposta =
      "Esse modelo não está disponível. Trabalhamos com botijão P13 ou P45. Qual você deseja?";
  } else {
    const pagamentoNovoDireto = extrairPagamento(mensagem);
    const quantidadeNovaDireta = extrairQuantidade(mensagem);

    if (pagamentoNovoDireto) {
      pagamento = pagamentoNovoDireto;
    }

    if (quantidadeNovaDireta && quantidadeNovaDireta > 0) {
      quantidade = quantidadeNovaDireta;
    }

    novaEtapa = "AGUARDANDO_PRODUTO";

    // CORRIGIDO: pergunta só o que ainda falta
    if (quantidade && Number(quantidade) > 0) {
      resposta = "Você deseja botijão P13 ou P45?";
    } else {
      resposta = "Você deseja botijão P13 ou P45? E quantos botijões?";
    }
  }
}

// ======================================================
// 2. AGUARDANDO QUANTIDADE
// ======================================================

else if (etapa === "AGUARDANDO_QUANTIDADE") {
  const quantidadeNova = extrairQuantidade(mensagem);
  const produtoNovo = extrairProduto(mensagemNormalizada);
  const pagamentoNovo = extrairPagamento(mensagem);

  if (produtoNovo) {
    produto = produtoNovo;
  }

  if (pagamentoNovo) {
    pagamento = pagamentoNovo;
  }

  if (quantidadeNova && quantidadeNova > 0) {
    quantidade = quantidadeNova;

    if (!produto) {
      novaEtapa = "AGUARDANDO_PRODUTO";
      resposta = "Você deseja botijão P13 ou P45?";
    } else if (!pagamento) {
      novaEtapa = "AGUARDANDO_PAGAMENTO";
      resposta =
        "Como deseja realizar o pagamento? Pix, dinheiro, cartão ou notinha?";
    } else {
      iniciarRecalculo();
    }
  } else if (temModeloNaoDisponivel(mensagemNormalizada)) {
    novaEtapa = "AGUARDANDO_PRODUTO";
    resposta =
      "Trabalhamos com botijão P13 ou P45. Qual modelo você deseja?";
  } else {
    novaEtapa = "AGUARDANDO_QUANTIDADE";
    resposta =
      "Informe quantos botijões você deseja. Exemplo: 1, 2 ou 3.";
  }
}

// ======================================================
// 3. AGUARDANDO PAGAMENTO
// ======================================================

else if (etapa === "AGUARDANDO_PAGAMENTO") {
  const pagamentoNovo = extrairPagamento(mensagem);

  if (!pagamentoNovo) {
    novaEtapa = "AGUARDANDO_PAGAMENTO";
    resposta =
      "Não identifiquei a forma de pagamento. Informe: Pix, dinheiro, cartão ou notinha.";
  } else {
    pagamento = pagamentoNovo;
    iniciarRecalculo();
  }
}

// ======================================================
// 4. AGUARDANDO NOME
// ======================================================

else if (etapa === "AGUARDANDO_NOME") {
  const nomeEEndereco = extrairNomeEEndereco(mensagem);

  if (!mensagem) {
    novaEtapa = "AGUARDANDO_NOME";
    resposta = "Por favor, informe seu nome.";
  } else if (nomeEEndereco && nomeEEndereco.nome && nomeEEndereco.endereco) {
    // NOVO: cliente mandou nome e endereço juntos
    nome = nomeEEndereco.nome;
    endereco = nomeEEndereco.endereco;
    continuarPedido();
  } else if (parecePedido && mensagem.length < 35) {
    novaEtapa = "AGUARDANDO_NOME";
    resposta =
      "Seu pedido já está anotado. Para continuar, informe apenas seu nome.";
  } else {
    nome = mensagem;
    novaEtapa = "AGUARDANDO_ENDERECO";
    resposta = "Obrigado, " + nome + "! Qual é o endereço para entrega?";
  }
}

// ======================================================
// 5. AGUARDANDO ENDEREÇO
// ======================================================

else if (etapa === "AGUARDANDO_ENDERECO") {
  if (!mensagem) {
    novaEtapa = "AGUARDANDO_ENDERECO";
    resposta = "Por favor, informe o endereço completo para entrega.";
  } else {
    endereco = mensagem;
    continuarPedido();
  }
}

// ======================================================
// 6. CONFIRMAR DADOS ANTERIORES
// ======================================================

else if (etapa === "CONFIRMAR_DADOS") {
  const respostaCliente = interpretarSimNao(mensagem) || mensagemNormalizada.toUpperCase();

  if (respostaCliente === "SIM" || respostaCliente === "S") {
    irParaConfirmacao();
  } else if (respostaCliente === "NAO" || respostaCliente === "N") {
    // CORRIGIDO: NÃO abre o menu e permite corrigir tudo, não só nome e endereço
    novaEtapa = "AGUARDANDO_CORRECAO";
    resposta = menuCorrecao();
  } else {
    novaEtapa = "CONFIRMAR_DADOS";
    resposta =
      "Encontrei seus dados anteriores:\n\n" +
      "Nome: " + nome + "\n" +
      "Endereço: " + endereco + "\n\n" +
      "Posso usar esses dados para esta entrega? Responda SIM ou NÃO.";
  }
}

// ======================================================
// 7. CONFIRMAR PEDIDO
// ======================================================

else if (etapa === "CONFIRMAR_PEDIDO") {
  const respostaCliente = interpretarSimNao(mensagem) || mensagemNormalizada.toUpperCase();

  if (respostaCliente === "SIM" || respostaCliente === "S") {
    if (pagamento === "PIX") {
      novaEtapa = "AGUARDANDO_COMPROVANTE_PIX";
      resposta = chavePix
        ? "Pedido confirmado! Faça o Pix de R$ " + formatarValor(valorTotal) +
          " para a chave " + chavePix + " e envie o comprovante por aqui."
        : "Pedido confirmado! Agora envie o comprovante do Pix por aqui.";
    } else if (pagamento === "DINHEIRO") {
      // NOVO: pagamento em dinheiro -> pergunta se precisa de troco
      troco = "";
      novaEtapa = "AGUARDANDO_TROCO";
      resposta = "Vai precisar de troco? 💵\n\nSe sim, me diga para quanto (ex.: 50 ou 100). Se não, responda NÃO.";
    } else {
      novaEtapa = "CRIAR_PEDIDO";
      resposta = "Pedido confirmado! Seu pedido será encaminhado para entrega.";
    }

    // Se a forma de pagamento não é dinheiro, limpa qualquer troco antigo
    if (pagamento !== "DINHEIRO") {
      troco = "";
    }
  } else if (respostaCliente === "NAO" || respostaCliente === "N") {
    novaEtapa = "AGUARDANDO_CORRECAO";
    resposta = menuCorrecao();
  } else {
    novaEtapa = "CONFIRMAR_PEDIDO";
    resposta = "Por favor, responda SIM para confirmar ou NÃO para corrigir.";
  }
}

// ======================================================
// 7B. AGUARDANDO TROCO (novo)
// ======================================================

else if (etapa === "AGUARDANDO_TROCO") {
  const valorNota = extrairValorTroco(mensagem);

  if (disseSemTroco(mensagem)) {
    troco = "";
    novaEtapa = "CRIAR_PEDIDO";
    resposta = resumoFinalPedido();
  } else if (valorNota !== null && valorNota > 0) {
    if (valorNota < valorTotal) {
      novaEtapa = "AGUARDANDO_TROCO";
      resposta =
        "O valor do pedido é R$ " + formatarValor(valorTotal) +
        ". Troco para quanto? (precisa ser um valor maior que esse)";
    } else if (valorNota === valorTotal) {
      troco = "";
      novaEtapa = "CRIAR_PEDIDO";
      resposta = resumoFinalPedido();
    } else {
      troco = valorNota;
      novaEtapa = "CRIAR_PEDIDO";
      resposta = resumoFinalPedido();
    }
  } else if (interpretarSimNao(mensagem) === "SIM") {
    novaEtapa = "AGUARDANDO_TROCO";
    resposta = "Troco para quanto? Ex.: 50 ou 100.";
  } else {
    novaEtapa = "AGUARDANDO_TROCO";
    resposta = "Não entendi. Vai precisar de troco? Diga o valor (ex.: 50 ou 100) ou responda NÃO.";
  }
}

// ======================================================
// 8. ESCOLHER O QUE CORRIGIR
// ======================================================

else if (etapa === "AGUARDANDO_CORRECAO") {
  const t = mensagemNormalizada;

  // CORRIGIDO: 1) número do menu; 2) nome/endereço; 3) valores informados
  // direto na mensagem; 4) só então as palavras soltas (produto, quantidade, pagamento).
  const opcaoMenu = t.match(/^([1-5])\s*[.)\-]?$/);

  // NOVO: vários números do menu ("2 e 5", "2, 5") ou vários nomes ("quantidade e endereço")
  const numerosMenu = /^[1-5](?:\s*(?:,|e|\+|&|\s)\s*[1-5])+\s*[.)]?$/.test(t)
    ? t.match(/[1-5]/g)
    : null;
  const nomesPorOpcao = { 1: "PRODUTO", 2: "QUANTIDADE", 3: "PAGAMENTO", 4: "NOME", 5: "ENDERECO" };

  let camposVarios = numerosMenu
    ? [...new Set(numerosMenu.map(n => nomesPorOpcao[n]))]
    : [];

  if (!camposVarios.length) {
    const semValores = !extrairProduto(t) && !extrairPagamento(mensagem) && !extrairQuantidade(mensagem);
    const citados = semValores ? camposCitados(t) : [];

    if (citados.length >= 2) {
      camposVarios = citados;
    }
  }

  // NOVO: nome e/ou endereço enviados na mesma mensagem. Vem antes da leitura
  // de quantidade, para o número da casa não virar quantidade de botijões.
  const nomeEEndereco = extrairNomeEEndereco(mensagem);

  if (camposVarios.length >= 2) {
    const ordem = ordenarCampos(camposVarios);
    const [primeiro, ...resto] = ordem;

    novaEtapa = etapaCorrecao(primeiro, resto);
    resposta =
      "Certo! Vamos corrigir um de cada vez. 😊\n\n" + perguntasCorrecao[primeiro];
  } else if (opcaoMenu) {
    const opcao = opcaoMenu[1];

    if (opcao === "1") {
      novaEtapa = "CORRIGIR_PRODUTO";
      resposta = "Qual produto deseja: P13 ou P45?";
    } else if (opcao === "2") {
      novaEtapa = "CORRIGIR_QUANTIDADE";
      resposta = "Qual é a nova quantidade desejada?";
    } else if (opcao === "3") {
      novaEtapa = "CORRIGIR_PAGAMENTO";
      resposta = "Qual será a forma de pagamento: Pix, dinheiro, cartão ou notinha?";
    } else if (opcao === "4") {
      novaEtapa = "CORRIGIR_NOME";
      resposta = "Certo. Informe o nome correto para este pedido.";
    } else {
      novaEtapa = "CORRIGIR_ENDERECO";
      resposta = "Certo. Informe o endereço correto para a entrega.";
    }
  } else if (nomeEEndereco) {
    if (nomeEEndereco.nome) {
      nome = nomeEEndereco.nome;
    }

    if (nomeEEndereco.endereco) {
      endereco = nomeEEndereco.endereco;
    }

    // Se veio produto, quantidade ou pagamento junto, recalcula o preço
    // (nome e endereço já ficam guardados). Senão, volta direto ao resumo.
    if (!(nomeEEndereco.resto && interpretarCorrecaoDireta(nomeEEndereco.resto))) {
      irParaConfirmacao();
    }
  } else if (/\b(nome|cliente)\b/.test(t)) {
    novaEtapa = "CORRIGIR_NOME";
    resposta = "Certo. Informe o nome correto para este pedido.";
  } else if (/\b(endereco|entrega|local)\b/.test(t)) {
    novaEtapa = "CORRIGIR_ENDERECO";
    resposta = "Certo. Informe o endereço correto para a entrega.";
  } else if (interpretarCorrecaoDireta()) {
    // A alteração foi identificada diretamente na mensagem.
  } else if (/\b(produto|modelo|ga[sz]|botijao|bujao)\b/.test(t)) {
    novaEtapa = "CORRIGIR_PRODUTO";
    resposta = "Qual produto deseja: P13 ou P45?";
  } else if (/\b(quantidade|qtd|unidades|botijoes)\b/.test(t)) {
    novaEtapa = "CORRIGIR_QUANTIDADE";
    resposta = "Qual é a nova quantidade desejada?";
  } else if (/\b(pagamento|pagar|forma)\b/.test(t)) {
    novaEtapa = "CORRIGIR_PAGAMENTO";
    resposta = "Qual será a forma de pagamento: Pix, dinheiro, cartão ou notinha?";
  } else {
    novaEtapa = "AGUARDANDO_CORRECAO";
    resposta =
      "O que deseja corrigir: produto, quantidade, pagamento, nome ou endereço? Você também pode informar diretamente o novo valor.";
  }
}

// ======================================================
// 9. CORRIGIR PRODUTO
// ======================================================

else if (etapaBase === "CORRIGIR_PRODUTO") {
  const produtoNovo = extrairProdutoPerguntado(mensagemNormalizada);

  if (produtoNovo) {
    produto = produtoNovo;

    if (!seguirFilaCorrecao()) {
      iniciarRecalculo("CORRECAO");
    }
  } else {
    novaEtapa = repetirEtapaCorrecao("PRODUTO");
    resposta =
      "Não identifiquei o modelo. Informe P13 ou P45.";
  }
}

// ======================================================
// 10. CORRIGIR QUANTIDADE
// ======================================================

else if (etapaBase === "CORRIGIR_QUANTIDADE") {
  const quantidadeNova = extrairQuantidade(mensagem);

  if (quantidadeNova && quantidadeNova > 0) {
    quantidade = quantidadeNova;

    if (!seguirFilaCorrecao()) {
      iniciarRecalculo("CORRECAO");
    }
  } else {
    novaEtapa = repetirEtapaCorrecao("QUANTIDADE");
    resposta = "Informe uma quantidade válida, como 1, 2 ou 3.";
  }
}

// ======================================================
// 11. CORRIGIR PAGAMENTO
// ======================================================

else if (etapaBase === "CORRIGIR_PAGAMENTO") {
  const pagamentoNovo = extrairPagamento(mensagem);

  if (pagamentoNovo) {
    pagamento = pagamentoNovo;

    if (!seguirFilaCorrecao()) {
      iniciarRecalculo("CORRECAO");
    }
  } else {
    novaEtapa = repetirEtapaCorrecao("PAGAMENTO");
    resposta =
      "Não identifiquei a forma de pagamento. Escolha Pix, dinheiro, cartão ou notinha.";
  }
}

// ======================================================
// 12. CORRIGIR NOME
// ======================================================

else if (etapaBase === "CORRIGIR_NOME") {
  if (!mensagem) {
    novaEtapa = repetirEtapaCorrecao("NOME");
    resposta = "Informe o nome correto, por favor.";
  } else {
    const nomeEEndereco = extrairNomeEEndereco(mensagem);

    if (nomeEEndereco && nomeEEndereco.nome && nomeEEndereco.endereco) {
      nome = nomeEEndereco.nome;
      endereco = nomeEEndereco.endereco;
    } else {
      nome = mensagem;
    }

    if (!seguirFilaCorrecao()) {
      irParaConfirmacao();
    }
  }
}

// ======================================================
// 13. CORRIGIR ENDEREÇO
// ======================================================

else if (etapaBase === "CORRIGIR_ENDERECO") {
  if (!mensagem) {
    novaEtapa = repetirEtapaCorrecao("ENDERECO");
    resposta = "Informe o endereço correto para a entrega.";
  } else {
    const nomeEEndereco = extrairNomeEEndereco(mensagem);

    if (nomeEEndereco && nomeEEndereco.nome && nomeEEndereco.endereco) {
      nome = nomeEEndereco.nome;
      endereco = nomeEEndereco.endereco;
    } else {
      endereco = mensagem;
    }

    if (!seguirFilaCorrecao()) {
      irParaConfirmacao();
    }
  }
}

// ======================================================
// 14. AGUARDANDO COMPROVANTE PIX
// ======================================================

else if (etapa === "AGUARDANDO_COMPROVANTE_PIX") {
  if (comprovanteRecebido) {
    novaEtapa = "CRIAR_PEDIDO";
    resposta =
      "Comprovante recebido! Seu pedido será encaminhado para conferência e entrega.";
  } else {
    novaEtapa = "AGUARDANDO_COMPROVANTE_PIX";
    resposta =
      "Ainda estou aguardando o comprovante do Pix" +
      (chavePix ? " (chave: " + chavePix + ")" : "") +
      ". Envie a imagem ou o PDF por aqui.";
  }
}

// ======================================================
// 15. CRIAR PEDIDO
// ======================================================

else if (etapa === "CRIAR_PEDIDO") {
  resposta = "Seu pedido já está sendo processado.";
}

// ======================================================
// 16. PERGUNTAR SE DESEJA ALGO MAIS
// ======================================================

else if (etapa === "PERGUNTAR_ALGO_MAIS") {
  const respostaCliente = interpretarSimNao(mensagem) || mensagemNormalizada.toUpperCase();

  // NOVO: "mais nada", "só isso" também encerram
  const disseNao =
    respostaCliente === "NAO" ||
    respostaCliente === "N" ||
    /\b(nada|so isso|apenas isso|por hoje)\b/.test(mensagemNormalizada);

  // NOVO: o cliente já pode responder pedindo ("quero outro gás normal", "mais um de cozinha")
  const querOutro =
    !disseNao &&
    (respostaCliente === "SIM" ||
      respostaCliente === "S" ||
      extrairProdutoPerguntado(mensagemNormalizada) !== null ||
      /\b(outro|outra|mais um|mais uma|mais \d+|quero|preciso|manda|mandar|botijao|botijoes|bujao|ga[sz])\b/.test(mensagemNormalizada));

  if (disseNao) {
    novaEtapa = "FINALIZADO";
    resposta =
      "Muito obrigado pela preferência! 😊\n\n" +
      "Seu pedido será entregue de 20 a 40 minutos! 😊\n\n" +
      "A Distribuidora Exemplo está sempre à sua disposição.\n\n" +
      "Até a próxima!";
  } else if (querOutro) {
    const atendimentoAnteriorFinalizado = {
      row_number: atendimento.row_number,
      telefone: atendimento.Telefone,
      etapa: "FINALIZADO",
      produto,
      quantidade,
      pagamento,
      nome,
      endereco,
      valor_unitario: valorUnitario,
      valor_total: valorTotal,
      troco,
      comprovante_recebido: comprovanteRecebido,
      id_atendimento: atendimento.IDAtendimento,
      novo_atendimento: false,
      resposta: ""
    };

    prepararNovoPedido(mensagem, false);

    novoAtendimento = true;
    idAtendimentoFinal = gerarIdAtendimento();
    rowNumberFinal = "";

    const novoAtendimentoItem = {
      row_number: rowNumberFinal,
      telefone: atendimento.Telefone,
      etapa: novaEtapa,
      produto,
      quantidade,
      pagamento,
      nome,
      endereco,
      valor_unitario: valorUnitario,
      valor_total: valorTotal,
      troco: "",
      comprovante_recebido: false,
      id_atendimento: idAtendimentoFinal,
      novo_atendimento: true,
      resposta
    };

    marcarConversa(atendimento.Telefone, true);

    return [
      { json: atendimentoAnteriorFinalizado },
      { json: novoAtendimentoItem }
    ];
  } else {
    novaEtapa = "PERGUNTAR_ALGO_MAIS";
    resposta = "Deseja mais alguma coisa? Responda SIM ou NÃO.";
  }
}

// ======================================================
// 17. CALCULAR PREÇO
// ======================================================

else if (etapa === "CALCULAR_PRECO") {
  resposta = "Estou calculando o valor do seu pedido.";
}

// ======================================================
// 18. FINALIZADO
// ======================================================

else if (etapa === "FINALIZADO") {
  if (parecePedido) {
    prepararNovoPedido(mensagem);

    novoAtendimento = true;
    idAtendimentoFinal = gerarIdAtendimento();
    rowNumberFinal = "";
  } else {
    resposta =
      "Este atendimento já foi finalizado. Se precisar de um novo pedido, é só me chamar. 😊";
  }
}

// ======================================================
// ETAPA DESCONHECIDA
// ======================================================

else {
  novaEtapa = etapa;
  resposta = "Não consegui identificar a etapa atual do atendimento: " + etapa;
}

// ======================================================
// RETORNO
// ======================================================

// NOVO: em áudio, quando o bot repete a pergunta, mostra o que entendeu.
// Ajuda o cliente e deixa claro quando a transcrição errou a palavra.
marcarConversa(atendimento.Telefone, novaEtapa !== "FINALIZADO");

const veioDeAudio = editFields1.tipo_mensagem === "audioMessage";
const etapasComPergunta = [
  "AGUARDANDO_PRODUTO",
  "AGUARDANDO_QUANTIDADE",
  "AGUARDANDO_PAGAMENTO",
  "CONFIRMAR_DADOS",
  "CONFIRMAR_PEDIDO",
  "AGUARDANDO_TROCO",
  "AGUARDANDO_CORRECAO"
];

if (veioDeAudio && mensagem && resposta && novaEtapa === etapa && etapasComPergunta.includes(etapa)) {
  resposta = 'Entendi: "' + mensagem + '"\n\n' + resposta;
}

return [{
  json: {
    row_number: rowNumberFinal,
    telefone: atendimento.Telefone,
    etapa: novaEtapa,
    produto,
    quantidade,
    pagamento,
    nome,
    endereco,
    valor_unitario: valorUnitario,
    valor_total: valorTotal,
    troco,
    comprovante_recebido: comprovanteRecebido,
    id_atendimento: idAtendimentoFinal,
    novo_atendimento: novoAtendimento,
    motivo_calculo: motivoCalculo,
    resposta
  }
}];
