/**
 * Simple Bitbucket authentication test - CommonJS version
 */

console.log("🔐 Iniciando prueba de autenticación de Bitbucket...\n");

// Verificar variables de entorno
const config = {
    baseUrl: process.env.BITBUCKET_URL || "https://api.bitbucket.org/2.0",
    username: process.env.BITBUCKET_USERNAME,
    password: process.env.BITBUCKET_PASSWORD,
    workspace: process.env.BITBUCKET_WORKSPACE,
};

console.log("📋 Configuración:");
console.log(`   Base URL: ${config.baseUrl}`);
console.log(`   Username: ${config.username}`);
console.log(
    `   Password: ${config.password ? "[CONFIGURADO]" : "[NO CONFIGURADO]"}`
);
console.log(`   Workspace: ${config.workspace}`);
console.log("");

if (!config.username || !config.password) {
    console.error("❌ Error: Faltan credenciales");
    console.error("   BITBUCKET_USERNAME:", config.username ? "✓" : "✗");
    console.error("   BITBUCKET_PASSWORD:", config.password ? "✓" : "✗");
    process.exit(1);
}

// Test básico con axios
console.log("📡 Probando conexión con Bitbucket API...");

const axios = require("axios");

const api = axios.create({
    baseURL: config.baseUrl,
    auth: {
        username: config.username,
        password: config.password,
    },
    timeout: 30000,
});

async function testAuth() {
    try {
        console.log("   Enviando request a /user...");
        const response = await api.get("/user");

        console.log("✅ ¡Autenticación exitosa!");
        console.log(`   Status: ${response.status}`);
        console.log(
            `   Usuario: ${
                response.data.display_name || response.data.username
            }`
        );
        console.log(`   Account ID: ${response.data.account_id}`);

        if (config.workspace) {
            console.log("\n🏢 Probando acceso al workspace...");
            try {
                const wsResponse = await api.get(
                    `/workspaces/${config.workspace}`
                );
                console.log("✅ Acceso al workspace exitoso!");
                console.log(`   Workspace: ${wsResponse.data.name}`);
            } catch (wsError) {
                console.error(
                    "❌ Error accediendo al workspace:",
                    wsError.response?.status,
                    wsError.response?.statusText
                );
            }
        }

        console.log("\n🎉 ¡Todas las pruebas pasaron!");
    } catch (error) {
        console.error("\n❌ Error de autenticación:");
        if (error.response) {
            console.error(
                `   Status: ${error.response.status} ${error.response.statusText}`
            );
            console.error(
                `   Error: ${JSON.stringify(error.response.data, null, 2)}`
            );

            if (error.response.status === 401) {
                console.error("\n💡 Sugerencias para error 401:");
                console.error("   - Verifica tu username y app password");
                console.error(
                    "   - Asegúrate de que el app password tenga los permisos correctos"
                );
            }
        } else {
            console.error(`   ${error.message}`);
        }
        process.exit(1);
    }
}

testAuth();
