// Integración de IA de costo cero: clasifica los mensajes de los clientes
// Proveedores soportados (variable AI_PROVIDER):
//   groq   -> API compatible con OpenAI, capa gratuita (https://console.groq.com)
//   gemini -> Google AI Studio, capa gratuita (https://aistudio.google.com)
//   local  -> clasificador por reglas (sin internet), útil como respaldo en la demo
const CATEGORIAS = ["Pedido", "Reclamo", "Consulta", "Urgencia cadena de frío"];

const PROMPT = (mensaje) => `Eres el asistente de atención de Cofrial SpA, distribuidora de alimentos refrigerados y congelados de La Araucanía (Chile).
Despachamos de lunes a sábado en La Araucanía, Los Ríos y Biobío. Los clientes B2B (hospitales, supermercados) compran con orden de compra y crédito; los B2C pagan al confirmar.
Clasifica el mensaje del cliente y responde SOLO con JSON válido, sin texto adicional, con esta forma:
{"categoria": una de ${JSON.stringify(CATEGORIAS)}, "prioridad": 1 (alta), 2 (media) o 3 (baja), "respuesta": "respuesta breve y amable en español, máximo 2 frases"}
Reglas: si menciona producto descongelado, blando, tibio, mal olor o temperatura, la categoría es "Urgencia cadena de frío" con prioridad 1.
Mensaje del cliente: """${mensaje}"""`;

function local(mensaje) {
  const m = mensaje.toLowerCase();
  if (/(descongel|blando|tibi|calient|temperatura|mal olor|olor|cadena de fr)/.test(m))
    return { categoria: "Urgencia cadena de frío", prioridad: 1, respuesta: "Lamentamos lo ocurrido. Registramos tu caso como urgencia de cadena de frío y un ejecutivo te contactará de inmediato." };
  if (/(reclamo|mal estado|incomplet|atras|no lleg|error|falt|devoluc)/.test(m))
    return { categoria: "Reclamo", prioridad: 2, respuesta: "Registramos tu reclamo y tu ejecutivo comercial lo revisará hoy mismo." };
  if (/(pedido|comprar|cotiz|necesito|quiero|cajas|kilos|kg)/.test(m))
    return { categoria: "Pedido", prioridad: 2, respuesta: "Puedes hacer tu pedido directamente en el catálogo; tu ejecutivo también recibirá esta solicitud." };
  return { categoria: "Consulta", prioridad: 3, respuesta: "Gracias por escribirnos. Despachamos de lunes a sábado en La Araucanía, Los Ríos y Biobío; un ejecutivo complementará esta respuesta si es necesario." };
}

function parse(texto) {
  const json = JSON.parse(String(texto).replace(/```json|```/g, "").trim().match(/\{[\s\S]*\}/)[0]);
  if (!CATEGORIAS.includes(json.categoria)) throw new Error("categoría inválida: " + json.categoria);
  json.prioridad = [1, 2, 3].includes(Number(json.prioridad)) ? Number(json.prioridad) : 2;
  return json;
}

async function groq(mensaje) {
  const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.AI_API_KEY}` },
    body: JSON.stringify({
      model: process.env.AI_MODEL || "llama-3.1-8b-instant",
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [{ role: "user", content: PROMPT(mensaje) }],
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw new Error(`Groq HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const data = await r.json();
  return parse(data.choices[0].message.content);
}

async function gemini(mensaje) {
  const model = process.env.AI_MODEL || "gemini-3.5-flash-lite";
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": process.env.AI_API_KEY },
    body: JSON.stringify({
      contents: [{ parts: [{ text: PROMPT(mensaje) }] }],
      generationConfig: { temperature: 0.2, responseMimeType: "application/json" },
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw new Error(`Gemini HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const data = await r.json();
  return parse(data.candidates[0].content.parts[0].text);
}

// Devuelve { categoria, prioridad, respuesta, motor }
async function clasificar(mensaje) {
  const prov = (process.env.AI_PROVIDER || "local").toLowerCase();
  try {
    if (prov === "groq" && process.env.AI_API_KEY) return { ...(await groq(mensaje)), motor: "groq" };
    if (prov === "gemini" && process.env.AI_API_KEY) return { ...(await gemini(mensaje)), motor: "gemini" };
  } catch (err) {
    console.error("[IA] Falló el proveedor externo, se usa el clasificador local:", err.message);
    return { ...local(mensaje), motor: "local (respaldo)" };
  }
  return { ...local(mensaje), motor: "local" };
}

module.exports = { clasificar, CATEGORIAS };
