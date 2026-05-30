const firebaseConfig = {
    apiKey: "AIzaSyBatvliROS57Vi0zWgEe24PoK7F3XamhgI",
    authDomain: "inventario-patrimonio.firebaseapp.com",
    projectId: "inventario-patrimonio",
    storageBucket: "inventario-patrimonio.firebasestorage.app",
    messagingSenderId: "92268650074",
    appId: "1:92268650074:web:8d8483900d960f81d08263"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const colecao = db.collection("patrimonios");
const configSessoesRef = db.collection("configuracoes").doc("sessoes");
const configLocaisRef = db.collection("configuracoes").doc("locais");

const ESTRUTURA_TRE_PADRAO = {
    NSEIS: [
        "ADM",
        "SEDE",
        "MOZARD",
        "BERNARDO MASCARENHAS",
        "JOSAFÁ BELO",
        "SALA BOMBEIROS (320)",
        "PORTARIA E ANDARES(320)",
        "CENTRO DE APOIO"
    ],
    "334ZE": ["334ZE"],
    "038ZE": ["038ZE"]
};

let ESTRUTURA_TRE = { ...ESTRUTURA_TRE_PADRAO };

let grafico = null;
let listenerAtivo = null;
let scanner = null;
let scannerTravado = false;
let localAtivoFiltro = "";
let locaisPorSessao = {};
let listenerSessoesAtivo = null;
let listenerLocaisAtivo = null;
let camerasDisponiveis = [];

document.addEventListener("DOMContentLoaded", iniciarSistema);

function iniciarSistema() {
    document.getElementById("selectSessao").addEventListener("change", verificarFluxoSessao);
    document.getElementById("selectLocal").addEventListener("change", ativarMonitoramentoFiltro);
    document.getElementById("btnConferir").addEventListener("click", buscarpatrimonio);
    document.getElementById("btnAbrirScanner").addEventListener("click", abrirScanner);
    document.getElementById("btnPararScanner").addEventListener("click", pararScanner);
    document.getElementById("selectCamera").addEventListener("change", trocarCameraSeScannerAberto);

    document.getElementById("campopatrimonio").addEventListener("keydown", evento => {
        if (evento.key === "Enter") buscarpatrimonio();
    });

    iniciarMonitoramentoSessoes();
    iniciarMonitoramentoLocais();
    carregarCamerasDisponiveis();
}

function iniciarMonitoramentoSessoes() {
    if (listenerSessoesAtivo) listenerSessoesAtivo();

    listenerSessoesAtivo = configSessoesRef.onSnapshot(doc => {
        const lista = doc.exists && Array.isArray(doc.data().lista)
            ? doc.data().lista
            : Object.keys(ESTRUTURA_TRE_PADRAO);

        aplicarSessoesConfiguradas(lista);
        carregarSessoesDoMapa();
        carregarLocaisDoFirebase();
    }, erro => {
        console.error(erro);
        aplicarSessoesConfiguradas(Object.keys(ESTRUTURA_TRE_PADRAO));
        carregarSessoesDoMapa();
        carregarLocaisDoFirebase();
    });
}

function carregarSessoesDoMapa() {
    const selectSessao = document.getElementById("selectSessao");
    const sessaoSelecionada = selectSessao.value;
    selectSessao.innerHTML = '<option value="" disabled selected>Escolha a sessao...</option>';

    Object.keys(ESTRUTURA_TRE).forEach(sessao => {
        const opt = document.createElement("option");
        opt.value = sessao;
        opt.textContent = sessao;
        selectSessao.appendChild(opt);
    });

    if (sessaoSelecionada && ESTRUTURA_TRE[sessaoSelecionada]) {
        selectSessao.value = sessaoSelecionada;
    }
}

function aplicarSessoesConfiguradas(lista) {
    const estrutura = {};

    lista.forEach(sessao => {
        const nome = normalizarTexto(sessao).toUpperCase();
        if (!nome) return;
        estrutura[nome] = ESTRUTURA_TRE_PADRAO[nome] || [nome];
    });

    ESTRUTURA_TRE = estrutura;
}

function iniciarMonitoramentoLocais() {
    if (listenerLocaisAtivo) listenerLocaisAtivo();

    listenerLocaisAtivo = configLocaisRef.onSnapshot(doc => {
        locaisPorSessao = doc.exists && doc.data().porSessao ? doc.data().porSessao : {};
        if (getSessaoAtual()) verificarFluxoSessao();
    }, erro => {
        console.error(erro);
    });
}

function carregarLocaisDoFirebase() {
    return configLocaisRef.get().then(doc => {
        locaisPorSessao = doc.exists && doc.data().porSessao ? doc.data().porSessao : {};
        if (getSessaoAtual()) verificarFluxoSessao();
    }).catch(erro => {
        console.error(erro);
    });
}

function getLocaisDaSessao(sessao) {
    const locaisFixos = ESTRUTURA_TRE[sessao] || [];
    const locaisBanco = locaisPorSessao[sessao] || [];
    return Array.from(new Set([...locaisFixos, ...locaisBanco]));
}

function verificarFluxoSessao() {
    const sessaoSel = document.getElementById("selectSessao").value;
    const blocoLocal = document.getElementById("blocoLocalColeta");
    const selectLocal = document.getElementById("selectLocal");
    const locaisDisponiveis = getLocaisDaSessao(sessaoSel);

    localAtivoFiltro = "";
    selectLocal.innerHTML = '<option value="" disabled selected>Escolha o local...</option>';

    if (locaisDisponiveis.length > 1) {
        locaisDisponiveis.forEach(local => {
            const opt = document.createElement("option");
            opt.value = local;
            opt.textContent = local;
            selectLocal.appendChild(opt);
        });
        blocoLocal.style.display = "block";
        limparTelaResumo();
        return;
    }

    blocoLocal.style.display = "none";
    localAtivoFiltro = locaisDisponiveis[0] || "";
    ativarMonitoramentoFiltro();
}

function getSessaoAtual() {
    return document.getElementById("selectSessao").value;
}

function getLocalAtual() {
    const blocoLocal = document.getElementById("blocoLocalColeta");
    if (blocoLocal.style.display === "block") {
        return document.getElementById("selectLocal").value;
    }
    return localAtivoFiltro;
}

function ativarMonitoramentoFiltro() {
    const sessaoSel = getSessaoAtual();
    localAtivoFiltro = getLocalAtual();

    if (!sessaoSel || !localAtivoFiltro) return;

    document.getElementById("tituloResumo").textContent = `Resumo: ${sessaoSel} (${localAtivoFiltro})`;

    if (listenerAtivo) listenerAtivo();

    listenerAtivo = colecao
        .where("sessao", "==", sessaoSel)
        .where("local", "==", localAtivoFiltro)
        .onSnapshot(snapshot => {
            const pendentes = [];
            const conferidos = [];

            snapshot.forEach(doc => {
                const item = { id: doc.id, ...doc.data() };
                if (item.status === "conferido") {
                    conferidos.push(item);
                } else {
                    pendentes.push(item);
                }
            });

            ordenarPorNumero(pendentes);
            ordenarPorNumero(conferidos);
            atualizarTela(pendentes, conferidos);
        }, erro => {
            console.error(erro);
            mostrarMensagem("mensagem", "Erro ao carregar dados do Firebase.", "erro");
        });
}

function limparTelaResumo() {
    atualizarTela([], []);
    document.getElementById("tituloResumo").textContent = "Resumo da Unidade";
}

function atualizarTela(pendentes, conferidos) {
    const total = pendentes.length + conferidos.length;

    document.getElementById("total").textContent = `Total: ${total}`;
    document.getElementById("pendentestotal").textContent = `Pendentes: ${pendentes.length}`;
    document.getElementById("conferidostotal").textContent = `Conferidos: ${conferidos.length}`;

    render("listapatrimonios", pendentes, false);
    render("listaconferidos", conferidos, true);
    atualizarGrafico(pendentes.length, conferidos.length);
}

function render(id, lista, showUser) {
    const ul = document.getElementById(id);
    ul.innerHTML = "";

    if (!lista.length) {
        const li = document.createElement("li");
        li.textContent = "Nenhum item nesta lista.";
        ul.appendChild(li);
        return;
    }

    lista.forEach(item => {
        const li = document.createElement("li");
        const partes = [
            item.patAntigo ? `Antigo: ${item.patAntigo}` : "",
            item.descricao || "Sem descricao",
            item.marca ? `Marca: ${item.marca}` : "",
            showUser && item.usuario ? `Resp: ${item.usuario}` : ""
        ].filter(Boolean);

        li.textContent = `${item.numero} - ${partes.join(" | ")}`;
        ul.appendChild(li);
    });
}

async function buscarpatrimonio() {
    const num = somenteDigitos(document.getElementById("campopatrimonio").value);
    const user = document.getElementById("campoUsuario").value.trim();
    const sessaoSel = getSessaoAtual();
    const localSel = getLocalAtual();

    if (!user) {
        mostrarMensagem("mensagem", "Digite o nome do responsavel.", "erro");
        document.getElementById("campoUsuario").focus();
        return;
    }

    if (!sessaoSel || !localSel) {
        mostrarMensagem("mensagem", "Selecione a sessao e o local primeiro.", "erro");
        return;
    }

    if (!num) {
        mostrarMensagem("mensagem", "Digite ou escaneie o patrimonio.", "erro");
        return;
    }

    try {
        const encontrado = await localizarPatrimonio(num, sessaoSel, localSel);

        if (!encontrado) {
            mostrarMensagem("mensagem", `Patrimonio ${num} nao localizado nesta unidade.`, "erro");
            return;
        }

        if (encontrado.dados.status === "conferido") {
            mostrarMensagem("mensagem", `Patrimonio ${num} ja estava conferido.`, "aviso");
            return;
        }

        await encontrado.ref.update({
            status: "conferido",
            usuario: user,
            conferidoEm: firebase.firestore.FieldValue.serverTimestamp()
        });

        vibrar();
        mostrarMensagem("mensagem", `Codigo ${encontrado.dados.numero} conferido por ${user}.`, "sucesso");
    } catch (erro) {
        console.error(erro);
        mostrarMensagem("mensagem", "Erro ao conferir patrimonio.", "erro");
    } finally {
        document.getElementById("campopatrimonio").value = "";
    }
}

async function localizarPatrimonio(numero, sessao, local) {
    const doc = await colecao.doc(criarIdItem(sessao, local, numero)).get();

    if (doc.exists) {
        const dados = doc.data();
        if (dados.sessao === sessao && dados.local === local) {
            return { ref: doc.ref, dados };
        }
    }

    return localizarPatrimonioLegado(numero, sessao, local);
}

async function localizarPatrimonioLegado(numero, sessao, local) {
    const numeroNormalizado = removerZerosAEsquerda(numero);
    const snapshot = await colecao
        .where("sessao", "==", sessao)
        .where("local", "==", local)
        .get();

    for (const doc of snapshot.docs) {
        const dados = doc.data();
        const candidatos = gerarAliasesNumero(dados.numero, dados.patAntigo);
        if (candidatos.includes(numero) || candidatos.includes(numeroNormalizado)) {
            return { ref: doc.ref, dados };
        }
    }

    return null;
}

function abrirScanner() {
    const user = document.getElementById("campoUsuario").value.trim();
    const sessaoSel = getSessaoAtual();
    const localSel = getLocalAtual();

    if (!user || !sessaoSel || !localSel) {
        mostrarMensagem("mensagem", "Informe responsavel, sessao e local antes de abrir a camera.", "erro");
        return;
    }

    if (scanner) return;

    scanner = new Html5Qrcode("reader");
    document.getElementById("btnAbrirScanner").disabled = true;
    mostrarMensagem("mensagem", "Abrindo camera...", "aviso");

    iniciarCameraSelecionada()
        .then(carregarCamerasDisponiveis)
        .catch(erro => {
            console.error(erro);
            mostrarMensagem("mensagem", "Erro na camera. Verifique permissao e use HTTPS.", "erro");
            document.getElementById("btnAbrirScanner").disabled = false;
            scanner = null;
        });
}

async function iniciarCameraSelecionada() {
    const cameraId = document.getElementById("selectCamera").value;
    const config = {
        fps: 10,
        qrbox: { width: 260, height: 170 },
        experimentalFeatures: { useBarCodeDetectorIfSupported: true },
        videoConstraints: {
            advanced: [
                { focusMode: "continuous" },
                { zoom: 1 }
            ]
        }
    };

    if (cameraId) {
        await scanner.start(
            cameraId,
            config,
            codigo => processarCodigoScanner(codigo),
            () => {}
        );
        mostrarMensagem("mensagem", "Camera selecionada aberta.", "sucesso");
        return;
    }

    try {
        await scanner.start(
            { facingMode: { exact: "environment" } },
            config,
            codigo => processarCodigoScanner(codigo),
            () => {}
        );
    } catch {
        await scanner.start(
            { facingMode: "environment" },
            config,
            codigo => processarCodigoScanner(codigo),
            () => {}
        );
    }

    mostrarMensagem("mensagem", "Camera traseira aberta.", "sucesso");
}

async function carregarCamerasDisponiveis() {
    if (!Html5Qrcode || !Html5Qrcode.getCameras) return;

    try {
        camerasDisponiveis = await Html5Qrcode.getCameras();
        preencherSelectCamera();
    } catch (erro) {
        console.warn(erro);
    }
}

function preencherSelectCamera() {
    const select = document.getElementById("selectCamera");
    const cameraAtual = select.value;
    select.innerHTML = '<option value="">Camera traseira automatica</option>';

    camerasDisponiveis
        .filter(camera => camera && camera.id)
        .sort((a, b) => pontuarCamera(b) - pontuarCamera(a))
        .forEach((camera, indice) => {
            const opt = document.createElement("option");
            opt.value = camera.id;
            opt.textContent = camera.label || `Camera ${indice + 1}`;
            select.appendChild(opt);
        });

    const melhorCamera = escolherMelhorCamera();
    if (cameraAtual && camerasDisponiveis.some(camera => camera.id === cameraAtual)) {
        select.value = cameraAtual;
    } else if (melhorCamera) {
        select.value = melhorCamera.id;
    }
}

function escolherMelhorCamera() {
    const cameras = camerasDisponiveis.filter(camera => camera && camera.id);
    if (!cameras.length) return null;
    return [...cameras].sort((a, b) => pontuarCamera(b) - pontuarCamera(a))[0];
}

function pontuarCamera(camera) {
    const label = normalizarChave(camera.label || "");
    let pontos = 0;

    if (label.includes("back") || label.includes("rear") || label.includes("traseira") || label.includes("environment")) pontos += 20;
    if (label.includes("camera 0") || label.includes("camera0")) pontos += 8;
    if (label.includes("wide")) pontos += 4;
    if (label.includes("main") || label.includes("principal")) pontos += 6;
    if (label.includes("front") || label.includes("frontal") || label.includes("selfie")) pontos -= 40;
    if (label.includes("ultra") || label.includes("0.5") || label.includes("macro")) pontos -= 20;
    if (label.includes("tele")) pontos -= 8;

    return pontos;
}

async function trocarCameraSeScannerAberto() {
    if (!scanner) return;

    await pararScanner();
    abrirScanner();
}

async function processarCodigoScanner(codigo) {
    if (scannerTravado) return;

    scannerTravado = true;
    document.getElementById("campopatrimonio").value = codigo;
    await buscarpatrimonio();

    setTimeout(() => {
        scannerTravado = false;
    }, 2000);
}

function pararScanner() {
    if (!scanner) {
        document.getElementById("btnAbrirScanner").disabled = false;
        return;
    }

    scanner.stop().then(() => {
        scanner.clear();
        scanner = null;
        scannerTravado = false;
        document.getElementById("btnAbrirScanner").disabled = false;
    }).catch(erro => {
        console.error(erro);
        scanner = null;
        document.getElementById("btnAbrirScanner").disabled = false;
    });
}

function atualizarGrafico(p, c) {
    const canvas = document.getElementById("graficopatrimonio");

    if (grafico) grafico.destroy();

    grafico = new Chart(canvas, {
        type: "doughnut",
        data: {
            labels: ["Pendentes", "Conferidos"],
            datasets: [{
                data: [p, c],
                backgroundColor: ["#e74c3c", "#2ecc71"],
                borderWidth: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: "bottom"
                }
            }
        }
    });
}

function somenteDigitos(valor) {
    return String(valor || "").replace(/\D/g, "").trim();
}

function removerZerosAEsquerda(valor) {
    const numero = somenteDigitos(valor);
    return numero.replace(/^0+/, "") || "0";
}

function gerarAliasesNumero(...valores) {
    const aliases = new Set();

    valores.forEach(valor => {
        const numero = somenteDigitos(valor);
        if (!numero) return;

        aliases.add(numero);
        aliases.add(removerZerosAEsquerda(numero));
    });

    return Array.from(aliases);
}

function normalizarTexto(valor) {
    return String(valor || "").trim().replace(/\s+/g, " ");
}

function normalizarChave(valor) {
    return normalizarTexto(valor)
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9 ]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function normalizarChaveLocal(valor) {
    return normalizarChave(valor)
        .replace(/\s*\(\s*/g, "(")
        .replace(/\s*\)\s*/g, ")")
        .replace(/\s+/g, " ")
        .trim();
}

function ordenarPorNumero(lista) {
    lista.sort((a, b) => String(a.numero).localeCompare(String(b.numero), "pt-BR", { numeric: true }));
}

function criarIdItem(sessao, local, numero) {
    return [sessao, local, somenteDigitos(numero)]
        .map(parte => normalizarChaveLocal(parte).replace(/[^a-z0-9]+/g, "-"))
        .join("__");
}

function vibrar() {
    if (navigator.vibrate) navigator.vibrate(200);
}

function mostrarMensagem(id, texto, tipo) {
    const msg = document.getElementById(id);
    msg.textContent = texto;
    msg.className = `mensagem ${tipo}`;
}
