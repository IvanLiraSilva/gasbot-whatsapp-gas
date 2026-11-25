// Node: Filtro antes da planilha  (Code, "Run Once for All Items")
// Fica entre "Assunto Gas" e o IF "Consultar planilha?".
// Decide, sem usar a planilha, se vale consultar o atendimento deste telefone.

const HORAS_CONVERSA = 6; // quanto tempo uma conversa de gás fica "aberta" depois da última mensagem

const d = $input.first().json; // saída do Assunto Gas

// mesma chave usada no Selecionar Atendimento Atual (ignora o "9" extra do celular)
function chaveTelefone(telefone) {
  const digitos = String(telefone || "").replace(/\D/g, "");
  const semPais = digitos.startsWith("55") && digitos.length >= 12 ? digitos.slice(2) : digitos;

  return semPais.length >= 10 ? semPais.slice(0, 2) + semPais.slice(-8) : digitos;
}

const registro = $getWorkflowStaticData('global');

if (!registro.ativos) {
  registro.ativos = {};
}

// remove conversas sem atividade há muito tempo
const limite = Date.now() - HORAS_CONVERSA * 60 * 60 * 1000;

for (const [tel, quando] of Object.entries(registro.ativos)) {
  if (Number(quando) < limite) {
    delete registro.ativos[tel];
  }
}

const chave = chaveTelefone(d.telefone || d.Telefone);
const mensagem = String(d.mensagem_cliente || "").trim();

// Reforço: reconhece gás mesmo com erro de escrita ("gaz", "botijao", "bujão")
const textoSemAcento = mensagem.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const falouDeGas = /\b(ga[sz]|botijao|botijoes|bujao|bujoes|p13|p45)\b/.test(textoSemAcento);

const assuntoGas = d.assunto_gas === true || falouDeGas;
const conversaAtiva = Boolean(chave && registro.ativos[chave]);
const comprovante = d.comprovante_recebido === true;

let motivo = "bloqueada";

if (!chave) {
  motivo = "sem telefone";
} else if (assuntoGas) {
  motivo = "gas";
} else if (conversaAtiva) {
  motivo = "conversa";
} else if (comprovante) {
  motivo = "comprovante";
}

const consultar = motivo !== "bloqueada" && motivo !== "sem telefone";

// Falou de gás ou está numa conversa: registra/renova (no máximo 1 gravação por minuto)
if ((assuntoGas || conversaAtiva) && chave) {
  const ultima = Number(registro.ativos[chave] || 0);

  if (Date.now() - ultima > 60 * 1000) {
    registro.ativos[chave] = Date.now();
  }
}

return [{
  json: {
    ...d,
    assunto_gas: assuntoGas,
    conversa_ativa: conversaAtiva,
    consultar_planilha: consultar,
    motivo_consulta: motivo
  }
}];
