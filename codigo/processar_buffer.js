// Node: Processar Buffer
// Entrada: itens do "Buscar Mensagens Buffer" (linhas desse telefone na aba BufferMensagens)

const dadosOriginais = $('Normalizar Mensagem').first().json;

// Horario (em milissegundos) que ESTA mensagem foi gravada no buffer
const meuHorario = Number(
  $('Salvar Mensagem no Buffer').first().json.DataHora
);

if (Number.isNaN(meuHorario)) {
  throw new Error(
    "DataHora do 'Salvar Mensagem no Buffer' nao e um numero. " +
    "Confira se o campo DataHora esta como {{ $now.toMillis() }}."
  );
}

// Linhas validas: DataHora numerica (ignora linhas antigas de teste com data em texto)
const linhas = $input.all()
  .map(item => item.json)
  .filter(l => {
    const texto = String(l.DataHora ?? "").trim();
    return texto !== "" && !Number.isNaN(Number(texto));
  });

// Ultima linha ja marcada como processada (tudo ate ela ja foi respondido)
let ultimaProcessada = 0;
for (const l of linhas) {
  if (String(l.Processado ?? "").trim().toUpperCase() === "SIM") {
    ultimaProcessada = Math.max(ultimaProcessada, Number(l.row_number));
  }
}

// Mensagens que ainda esperam resposta, em ordem de chegada
const pendentes = linhas
  .filter(l => Number(l.row_number) > ultimaProcessada)
  .sort((a, b) => Number(a.DataHora) - Number(b.DataHora));

// Se chegou alguma mensagem mais nova que a minha, essa execucao para aqui
const existeMaisNova = pendentes.some(l => Number(l.DataHora) > meuHorario);

if (existeMaisNova) {
  return [{
    json: {
      ...dadosOriginais, // mantem telefone, tipo_mensagem, comprovante_recebido etc.
      eh_mais_recente: false
    }
  }];
}

// Sou a mais recente: junto tudo que estava pendente numa mensagem so
const doGrupo = pendentes.filter(l => Number(l.DataHora) <= meuHorario);

const mensagemCombinada = doGrupo
  .map(l => String(l.Mensagem ?? "").trim())
  .filter(texto => texto.length > 0)
  .join(" ");

const ultimaLinha = doGrupo[doGrupo.length - 1];

return [{
  json: {
    ...dadosOriginais, // mantem telefone, tipo_mensagem, comprovante_recebido etc.
    mensagem_cliente: mensagemCombinada, // troca so esse campo
    eh_mais_recente: true,
    buffer_row_number: ultimaLinha ? Number(ultimaLinha.row_number) : null
  }
}];
