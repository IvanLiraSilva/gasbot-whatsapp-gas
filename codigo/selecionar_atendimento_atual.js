const items = $input.all();

const assuntoGas =
  $('Filtro antes da planilha').first().json.assunto_gas === true;

// NOVO: compara telefones ignorando o "9" extra do celular (551199999999 e 5511999999999
// são a mesma pessoa): usa DDD + últimos 8 dígitos.
function chaveTelefone(telefone) {
  const digitos = String(telefone || "").replace(/\D/g, "");
  const semPais = digitos.startsWith("55") && digitos.length >= 12 ? digitos.slice(2) : digitos;

  return semPais.length >= 10 ? semPais.slice(0, 2) + semPais.slice(-8) : digitos;
}

// Telefone de quem acabou de escrever. Só vale atendimento desse telefone.
const normalizada = $('Normalizar Mensagem').first().json;
const telefoneAtual = chaveTelefone(normalizada.telefone || normalizada.Telefone);

const atendimentos = items.filter(item =>
  item.json &&
  Object.keys(item.json).length > 0 &&
  item.json.row_number &&
  chaveTelefone(item.json.Telefone) === telefoneAtual
);

if (!atendimentos.length) {
  return [{
    json: {
      assunto_gas: assuntoGas,
      atendimento_ativo: false,
      Etapa: ""
    }
  }];
}

const ordenados = [...atendimentos].sort((a, b) => {
  const linhaA = Number(a.json.row_number || 0);
  const linhaB = Number(b.json.row_number || 0);

  return linhaB - linhaA;
});

const atual = ordenados[0].json;

const atendimentoAtivo =
  String(atual.Etapa || "").trim() !== "" &&
  String(atual.Etapa || "").trim() !== "FINALIZADO";

return [{
  json: {
    ...atual,
    assunto_gas: assuntoGas,
    atendimento_ativo: atendimentoAtivo
  }
}];
