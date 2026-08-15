export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // GET /api/messages - Fetch messages from Turso
    if (url.pathname === "/api/messages" && request.method === "GET") {
      return handleGetMessages(env);
    }

    // POST /api/messages - Save a message to Turso
    if (url.pathname === "/api/messages" && request.method === "POST") {
      return handlePostMessage(request, env);
    }

    // Fallback: serve index.html or other static files from the ASSETS binding
    return env.ASSETS.fetch(request);
  }
};

function getTursoHttpUrl(url) {
    if (!url) return "";
    let httpUrl = url;
    if (httpUrl.startsWith("libsql://")) {
        httpUrl = "https://" + httpUrl.substring(9);
    }
    if (httpUrl.endsWith("/")) {
        httpUrl = httpUrl.slice(0, -1);
    }
    return `${httpUrl}/v2/pipeline`;
}

function extractValue(item) {
    if (item && typeof item === 'object') {
        if ('value' in item) return item.value;
        if (item.type === 'null') return null;
    }
    return item;
}

async function handleGetMessages(env) {
    const dbUrl = env.TURSO_DATABASE_URL;
    const dbToken = env.TURSO_AUTH_TOKEN;

    if (!dbUrl || !dbToken) {
        return new Response(JSON.stringify({ 
            error: "Base de datos Turso no configurada en las variables de entorno de Cloudflare." 
        }), {
            status: 500,
            headers: { 
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*"
            }
        });
    }

    const httpUrl = getTursoHttpUrl(dbUrl);

    try {
        const response = await fetch(httpUrl, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${dbToken}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                requests: [
                    {
                        type: "execute",
                        stmt: {
                            sql: "CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, country TEXT, text TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)"
                        }
                    },
                    {
                        type: "execute",
                        stmt: {
                            sql: "SELECT name, country, text, created_at FROM messages ORDER BY id DESC LIMIT 50"
                        }
                    },
                    {
                        type: "close"
                    }
                ]
            })
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`Error de Turso: ${response.status} - ${errText}`);
        }

        const data = await response.json();
        const selectResult = data.results && data.results[1];
        
        if (selectResult && selectResult.type === "ok" && selectResult.response && selectResult.response.result) {
            const { cols, rows } = selectResult.response.result;
            const colNames = cols.map(c => c.name);
            
            const messages = rows.map(row => {
                const message = {};
                colNames.forEach((col, idx) => {
                    message[col] = extractValue(row[idx]);
                });
                message.time = formatTime(message.created_at);
                return message;
            });

            return new Response(JSON.stringify(messages), {
                headers: { 
                    "Content-Type": "application/json",
                    "Access-Control-Allow-Origin": "*"
                }
            });
        }

        return new Response(JSON.stringify([]), {
            headers: { 
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*"
            }
        });

    } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
            headers: { 
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*"
            }
        });
    }
}

async function handlePostMessage(request, env) {
    const dbUrl = env.TURSO_DATABASE_URL;
    const dbToken = env.TURSO_AUTH_TOKEN;

    if (!dbUrl || !dbToken) {
        return new Response(JSON.stringify({ 
            error: "Base de datos Turso no configurada en las variables de entorno." 
        }), {
            status: 500,
            headers: { 
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*"
            }
        });
    }

    try {
        const { name, country, text } = await request.json();

        if (!name || !text) {
            return new Response(JSON.stringify({ error: "Nombre y mensaje son requeridos." }), {
                status: 400,
                headers: { 
                    "Content-Type": "application/json",
                    "Access-Control-Allow-Origin": "*"
                }
            });
        }

        const httpUrl = getTursoHttpUrl(dbUrl);

        const response = await fetch(httpUrl, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${dbToken}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                requests: [
                    {
                        type: "execute",
                        stmt: {
                            sql: "INSERT INTO messages (name, country, text) VALUES (?, ?, ?)",
                            args: [
                                { type: "text", value: name },
                                { type: "text", value: country || "🌐 Otro País" },
                                { type: "text", value: text }
                            ]
                        }
                    },
                    {
                        type: "close"
                    }
                ]
            })
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`Error de Turso: ${response.status} - ${errText}`);
        }

        return new Response(JSON.stringify({ success: true }), {
            status: 201,
            headers: { 
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*"
            }
        });

    } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
            headers: { 
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*"
            }
        });
    }
}

function formatTime(createdAtStr) {
    if (!createdAtStr) return "Hace un momento";
    try {
        const formattedStr = createdAtStr.replace(" ", "T") + "Z";
        const date = new Date(formattedStr);
        const now = new Date();
        const diffMs = now.getTime() - date.getTime();
        const diffMin = Math.floor(diffMs / (1000 * 60));

        if (diffMin < 1) return "Hace un momento";
        if (diffMin < 60) return `Hace ${diffMin} min`;
        const diffHrs = Math.floor(diffMin / 60);
        if (diffHrs < 24) return `Hace ${diffHrs} ${diffHrs === 1 ? 'hora' : 'horas'}`;
        
        return date.toLocaleDateString("es-CR", { day: 'numeric', month: 'short' });
    } catch (e) {
        return "Hace poco";
    }
}
