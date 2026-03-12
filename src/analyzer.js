const Anthropic = require('@anthropic-ai/sdk')

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

async function analyzeCandidate(candidate) {
  const answers = (candidate.text_answers || [])
    .filter(a => a.answer && a.answer.trim().length > 2)
    .map(a => `P: ${a.question}\nR: ${a.answer}`)
    .join('\n\n')

  const prompt = `Você é um recrutador sênior avaliando um candidato para a seguinte vaga:

CARGO: ${candidate.form_title}
CONTEXTO: ${candidate.role_context}
SALÁRIO PRETENDIDO: ${candidate.salary_raw || 'não informado'}
EXPERIÊNCIA NA ÁREA: ${candidate.experience_raw || 'não informado'}

RESPOSTAS DO CANDIDATO:
${answers || 'Sem respostas disponíveis'}

Analise este candidato de forma objetiva e responda SOMENTE com um JSON válido neste formato exato:
{
  "resumo": "2-3 frases sobre o perfil geral do candidato",
  "pontos_fortes": ["ponto 1", "ponto 2", "ponto 3"],
  "pontos_atencao": ["ponto 1", "ponto 2"],
  "fit_cargo": "Alto | Médio | Baixo",
  "recomendacao": "1-2 frases de recomendação direta sobre avançar ou não",
  "score_ia": 0
}

O campo score_ia deve ser um número de 0 a 10 refletindo o fit geral com o cargo.
Seja direto, prático e baseado apenas nas respostas fornecidas.`

  const response = await client.messages.create({
    model:      'claude-haiku-4-5-20251001',
    max_tokens: 600,
    messages:   [{ role: 'user', content: prompt }],
  })

  const text = response.content[0].text.trim()

  // Extrai JSON da resposta
  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error('Resposta da IA não contém JSON válido')

  return JSON.parse(jsonMatch[0])
}

module.exports = { analyzeCandidate }
