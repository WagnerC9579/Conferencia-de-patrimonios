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
const divergenciasColecao = db.collection("divergencias");
const transferenciasColecao = db.collection("transferencias");
const naoCadastradosColecao = db.collection("naoCadastrados");
const contagensColecao = db.collection("contagens");
const configSessoesRef = db.collection("configuracoes").doc("sessoes");
const configLocaisRef = db.collection("configuracoes").doc("locais");
const PREFIXO_SEGURANCA_PATRIMONIO = "67";
const CHAVE_ESTADO_OPERADOR = "inventarioPatrimonial.estadoOperador";


const ESTRUTURA_TRE_PADRAO = {
    NSEIS: [],
    "334ZE": [],
    "038ZE": []
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
let estadoOperador = carregarEstadoOperador();

document.addEventListener("DOMContentLoaded", iniciarSistema);

function iniciarSistema() {
    const selectSessao = document.getElementById("selectSessao");
    const selectLocal = document.getElementById("selectLocal");
    const campoUsuario = document.getElementById("campoUsuario");

    campoUsuario.value = estadoOperador.usuario || "";

    selectSessao.addEventListener("change", () => {
        verificarFluxoSessao();
        salvarEstadoOperador();
    });

    selectLocal.addEventListener("change", () => {
        ativarMonitoramentoFiltro();
        salvarEstadoOperador();
    });

    campoUsuario.addEventListener("input", salvarEstadoOperador);
    document.getElementById("btnConferir").addEventListener("click", buscarpatrimonio);
    document.getElementById("btnAbrirScanner").addEventListener("click", abrirScanner);
    document.getElementById("btnPararScanner").addEventListener("click", pararScanner);
    document.getElementById("btnExportarRelatorioOperador").addEventListener("click", exportarRelatorioOperador);
    document.getElementById("btnRegistrarContagem").addEventListener("click", registrarContagemSemLeitura);

    document.getElementById("campopatrimonio").addEventListener("keydown", evento => {
        if (evento.key === "Enter") buscarpatrimonio();
    });

    iniciarMonitoramentoSessoes();
    iniciarMonitoramentoLocais();
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
    const sessaoSelecionada = selectSessao.value || estadoOperador.sessao;
    selectSessao.innerHTML = '<option value="" disabled selected>Escolha a lotação...</option>';

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
        estrutura[nome] = ESTRUTURA_TRE_PADRAO[nome] || [];
    });

    ESTRUTURA_TRE = estrutura;
}

function iniciarMonitoramentoLocais() {
    if (listenerLocaisAtivo) listenerLocaisAtivo();

    listenerLocaisAtivo = configLocaisRef.onSnapshot(doc => {
        locaisPorSessao = limparLocaisIguaisASessao(doc.exists && doc.data().porSessao ? doc.data().porSessao : {});
        if (getSessaoAtual()) verificarFluxoSessao();
    }, erro => {
        console.error(erro);
    });
}

function carregarLocaisDoFirebase() {
    return configLocaisRef.get().then(doc => {
        locaisPorSessao = limparLocaisIguaisASessao(doc.exists && doc.data().porSessao ? doc.data().porSessao : {});
        if (getSessaoAtual()) verificarFluxoSessao();
    }).catch(erro => {
        console.error(erro);
    });
}

function limparLocaisIguaisASessao(porSessao) {
    const limpo = {};

    Object.entries(porSessao || {}).forEach(([sessao, locais]) => {
        if (!Array.isArray(locais)) {
            limpo[sessao] = [];
            return;
        }

        limpo[sessao] = locais.filter(Boolean);
    });

    return limpo;
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

    if (!locaisDisponiveis.length) {
        blocoLocal.style.display = "none";
        limparTelaResumo();
        return;
    }

    if (locaisDisponiveis.length > 1) {
        locaisDisponiveis.forEach(local => {
            const opt = document.createElement("option");
            opt.value = local;
            opt.textContent = local;
            selectLocal.appendChild(opt);
        });

        blocoLocal.style.display = "block";

        if (estadoOperador.sessao === sessaoSel && estadoOperador.local && locaisDisponiveis.includes(estadoOperador.local)) {
            selectLocal.value = estadoOperador.local;
            ativarMonitoramentoFiltro();
        } else {
            limparTelaResumo();
        }
        return;
    }

    blocoLocal.style.display = "none";
    localAtivoFiltro = locaisDisponiveis[0];
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
    salvarEstadoOperador();

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
            mostrarMensagem("mensagem", "Erro ao carregar os dados do Firebase.", "erro");
        });
}

function limparTelaResumo() {
    atualizarTela([], []);
    document.getElementById("tituloResumo").textContent = "Resumo da unidade";
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
            item.descricao || "Sem descrição",
            item.marca ? `Marca: ${item.marca}` : "",
            showUser && item.usuario ? `Responsável: ${item.usuario}` : ""
        ].filter(Boolean);

        li.textContent = `${item.numero} - ${partes.join(" | ")}`;
        ul.appendChild(li);
    });
}

async function buscarpatrimonio() {
    const num = somenteDigitos(document.getElementById("campopatrimonio").value);
    const numSemPrefixo = removerPrefixoSegurancaPatrimonio(num);
    const user = document.getElementById("campoUsuario").value.trim();
    const sessaoSel = getSessaoAtual();
    const localSel = getLocalAtual();

    if (!user) {
        mostrarMensagem("mensagem", "Digite o nome do responsável.", "erro");
        document.getElementById("campoUsuario").focus();
        return;
    }

    if (!sessaoSel || !localSel) {
        mostrarMensagem("mensagem", "Selecione a lotação e o local primeiro.", "erro");
        return;
    }

    if (!num) {
        mostrarMensagem("mensagem", "Digite ou escaneie o patrimônio.", "erro");
        return;
    }

    try {
        const encontrado = await localizarPatrimonio(num, sessaoSel, localSel);

        if (!encontrado) {
            const encontradoEmOutroLocal = await localizarPatrimonioEmTodoBanco(num, sessaoSel, localSel);

            if (encontradoEmOutroLocal) {
                await registrarTransferencia(num, numSemPrefixo, encontradoEmOutroLocal, sessaoSel, localSel, user);
                vibrar();
                mostrarStatusLeitura(`Fora do local: ${encontradoEmOutroLocal.dados.numero || numSemPrefixo}`, "aviso");
                return;
            }

            await registrarNaoCadastrado(num, numSemPrefixo, sessaoSel, localSel, user);
            mostrarStatusLeitura(`Não consta: ${numSemPrefixo}`, "erro");
            return;
        }

        if (encontrado.dados.status === "conferido") {
            mostrarStatusLeitura(`Já conferido: ${encontrado.dados.numero || numSemPrefixo}`, "aviso");
            return;
        }

        await encontrado.ref.update({
            status: "conferido",
            usuario: user,
            conferidoEm: firebase.firestore.FieldValue.serverTimestamp()
        });

        vibrar();
        mostrarStatusLeitura(`Conferido: ${encontrado.dados.numero}`, "sucesso");
    } catch (erro) {
        console.error(erro);
        mostrarMensagem("mensagem", "Erro ao conferir o patrimônio.", "erro");
    } finally {
        const campoPatrimonio = document.getElementById("campopatrimonio");
        campoPatrimonio.value = "";
        campoPatrimonio.focus();
    }
}

async function localizarPatrimonio(numero, sessao, local) {
    const numerosBusca = gerarNumerosBuscaPatrimonio(numero);

    for (const numeroBusca of numerosBusca) {
        const doc = await colecao.doc(criarIdItem(sessao, local, numeroBusca)).get();

        if (doc.exists) {
            const dados = doc.data();
            if (dados.sessao === sessao && dados.local === local) {
                return { ref: doc.ref, dados };
            }
        }
    }

    return localizarPatrimonioLegado(numero, sessao, local);
}

async function localizarPatrimonioLegado(numero, sessao, local) {
    const numerosBusca = gerarNumerosBuscaPatrimonio(numero);
    const snapshot = await colecao
        .where("sessao", "==", sessao)
        .where("local", "==", local)
        .get();

    for (const doc of snapshot.docs) {
        const dados = doc.data();
        const candidatos = gerarAliasesNumero(dados.numero, dados.patAntigo);
        if (numerosBusca.some(numeroBusca => candidatos.includes(numeroBusca))) {
            return { ref: doc.ref, dados };
        }
    }

    return null;
}

async function localizarPatrimonioEmTodoBanco(numero, sessaoAtual, localAtual) {
    const numerosBusca = gerarNumerosBuscaPatrimonio(numero);
    const candidatos = [];

    try {
        const snapshotAliases = await colecao
            .where("aliases", "array-contains-any", numerosBusca.slice(0, 10))
            .get();

        snapshotAliases.forEach(doc => candidatos.push(doc));
    } catch (erro) {
        console.warn("Busca por aliases indisponível. Usando varredura simples.", erro);
    }

    if (!candidatos.length) {
        const snapshot = await colecao.get();
        snapshot.forEach(doc => candidatos.push(doc));
    }

    for (const doc of candidatos) {
        const dados = doc.data();
        const aliases = gerarAliasesNumero(dados.numero, dados.patAntigo);
        const mesmoNumero = numerosBusca.some(numeroBusca => aliases.includes(numeroBusca));
        const mesmoLocal = dados.sessao === sessaoAtual && dados.local === localAtual;

        if (mesmoNumero && !mesmoLocal) {
            return { ref: doc.ref, dados };
        }
    }

    return null;
}

async function registrarDivergencia(numero, numeroSemPrefixo, sessao, local, usuario) {
    await divergenciasColecao.add({
        numeroInformado: numero,
        numeroSemPrefixo,
        sessao,
        local,
        usuario,
        motivo: "Patrimônio não localizado na lotação/local selecionado.",
        criadoEm: firebase.firestore.FieldValue.serverTimestamp()
    });
}

async function registrarNaoCadastrado(numeroInformado, numeroSemPrefixo, sessao, local, usuario) {
    const id = criarIdNaoCadastrado(sessao, local, numeroSemPrefixo || numeroInformado);
    const ref = naoCadastradosColecao.doc(id);
    const existente = await ref.get();

    await ref.set({
        numeroInformado,
        numeroSemPrefixo,
        sessao,
        local,
        usuario,
        status: "Não consta na base",
        motivo: "Patrimônio lido no local, mas não encontrado em nenhuma planilha importada.",
        primeiraLeituraEm: existente.exists && existente.data().primeiraLeituraEm
            ? existente.data().primeiraLeituraEm
            : firebase.firestore.FieldValue.serverTimestamp(),
        ultimaLeituraEm: firebase.firestore.FieldValue.serverTimestamp(),
        leituras: firebase.firestore.FieldValue.increment(1)
    }, { merge: true });
}

async function registrarTransferencia(numeroInformado, numeroSemPrefixo, encontrado, sessaoEncontrada, localEncontrado, usuario) {
    const dados = encontrado.dados;
    const id = criarIdTransferencia(dados.sessao, dados.local, sessaoEncontrada, localEncontrado, dados.numero || numeroSemPrefixo);
    const ref = transferenciasColecao.doc(id);
    const existente = await ref.get();

    await ref.set({
        numeroInformado,
        numeroSemPrefixo,
        numero: dados.numero || numeroSemPrefixo,
        patAntigo: dados.patAntigo || "",
        descricao: dados.descricao || "",
        marca: dados.marca || "",
        lotacaoCadastrada: dados.sessao || "",
        localCadastrado: dados.local || "",
        lotacaoEncontrada: sessaoEncontrada,
        localEncontrado,
        responsavel: usuario,
        status: "Transferência pendente",
        motivo: "Patrimônio encontrado fisicamente em local diferente do cadastro.",
        primeiraLeituraEm: existente.exists && existente.data().primeiraLeituraEm
            ? existente.data().primeiraLeituraEm
            : firebase.firestore.FieldValue.serverTimestamp(),
        ultimaLeituraEm: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
}

async function abrirScanner() {
    const user = document.getElementById("campoUsuario").value.trim();
    const sessaoSel = getSessaoAtual();
    const localSel = getLocalAtual();

    if (!user || !sessaoSel || !localSel) {
        mostrarMensagem("mensagem", "Informe o responsável, a lotação e o local antes de abrir a câmera.", "erro");
        return;
    }

    if (scanner) return;

    mostrarAreaScanner(true);
    scanner = new Html5Qrcode("reader");
    document.getElementById("btnAbrirScanner").disabled = true;
    mostrarMensagem("mensagem", "Abrindo câmera...", "aviso");

    iniciarCameraTraseira()
        .catch(erro => {
            console.error(erro);
            mostrarMensagem("mensagem", "Não encontrei uma câmera traseira válida neste navegador.", "erro");
            document.getElementById("btnAbrirScanner").disabled = false;
            scanner = null;
            scannerTravado = false;
            mostrarAreaScanner(false);
        });
}

async function iniciarCameraTraseira() {
    const config = {
        fps: 10,
        qrbox: { width: 260, height: 170 },
        experimentalFeatures: { useBarCodeDetectorIfSupported: true }
    };

    const cameras = await listarCamerasDoAparelho();
    const candidatas = ordenarCamerasParaLeitura(cameras);

    for (const camera of candidatas) {
        try {
            await scanner.start(
                camera.id,
                config,
                codigo => processarCodigoScanner(codigo),
                () => {}
            );

            await aguardar(350);

            if (cameraAtivaPareceFrontal()) {
                await pararScannerSilencioso();
                scanner = new Html5Qrcode("reader");
                continue;
            }

            await ajustarCameraParaLeituraPerto();
            mostrarMensagem("mensagem", "Câmera traseira aberta.", "sucesso");
            return;
        } catch (erro) {
            console.warn("Câmera recusada.", camera.label || camera.id, erro);
            await pararScannerSilencioso();
            mostrarAreaScanner(true);
            scanner = new Html5Qrcode("reader");
        }
    }

    throw new Error("Nenhuma câmera traseira foi aceita pelo navegador.");
}

async function listarCamerasDoAparelho() {
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        let stream = null;

        try {
            stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        } finally {
            if (stream) stream.getTracks().forEach(track => track.stop());
        }
    }

    if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const cameras = devices
            .filter(device => device.kind === "videoinput")
            .map((device, index) => ({
                id: device.deviceId,
                label: device.label || `Câmera ${index + 1}`,
                index
            }));

        if (cameras.length) return cameras;
    }

    if (Html5Qrcode.getCameras) {
        const cameras = await Html5Qrcode.getCameras();
        return cameras.map((camera, index) => ({ ...camera, index }));
    }

    return [];
}

function ordenarCamerasParaLeitura(cameras) {
    return cameras
        .filter(camera => camera && camera.id)
        .filter(camera => !ehCameraFrontal(camera.label))
        .sort((a, b) => pontuarCameraLeitura(b) - pontuarCameraLeitura(a));
}

function pontuarCameraLeitura(camera) {
    const label = normalizarChave(camera.label || "");
    let pontos = 0;

    if (label.includes("back") || label.includes("rear") || label.includes("traseira") || label.includes("environment")) pontos += 100;
    if (label.includes("main") || label.includes("principal")) pontos += 30;
    if (label.includes("wide")) pontos += 10;
    if (label.includes("tele")) pontos -= 10;
    if (label.includes("ultra") || label.includes("0 5") || label.includes("macro")) pontos -= 30;
    pontos += (camera.index || 0);

    return pontos;
}

function ehCameraFrontal(label) {
    const texto = normalizarChave(label || "");
    return texto.includes("front")
        || texto.includes("frontal")
        || texto.includes("selfie")
        || texto.includes("user")
        || texto.includes("dianteira");
}

function cameraAtivaPareceFrontal() {
    const video = document.querySelector("#reader video");
    const stream = video && video.srcObject;
    const track = stream && stream.getVideoTracks ? stream.getVideoTracks()[0] : null;

    if (!track) return false;

    const settings = track.getSettings ? track.getSettings() : {};
    const label = track.label || "";

    return settings.facingMode === "user" || ehCameraFrontal(label);
}

async function pararScannerSilencioso() {
    if (!scanner) return;

    try {
        if (scanner.isScanning) await scanner.stop();
        await scanner.clear();
    } catch (erro) {
        console.warn(erro);
    }
}

function mostrarAreaScanner(visivel) {
    const reader = document.getElementById("reader");
    reader.classList.toggle("scanner-visivel", visivel);

    if (!visivel) {
        reader.innerHTML = "";
    }
}

function aguardar(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function ajustarCameraParaLeituraPerto() {
    const video = document.querySelector("#reader video");
    const stream = video && video.srcObject;
    const track = stream && stream.getVideoTracks ? stream.getVideoTracks()[0] : null;

    if (!track || !track.getCapabilities || !track.applyConstraints) return;

    try {
        const capabilities = track.getCapabilities();
        const advanced = [];

        if (capabilities.focusMode && capabilities.focusMode.includes("continuous")) {
            advanced.push({ focusMode: "continuous" });
        }

        if (capabilities.zoom) {
            const min = capabilities.zoom.min || 1;
            const max = capabilities.zoom.max || 1;
            const zoomPerto = Math.min(Math.max(2, min), max);
            advanced.push({ zoom: zoomPerto });
        }

        if (advanced.length) {
            await track.applyConstraints({ advanced });
        }
    } catch (erro) {
        console.warn("A câmera não aceitou ajuste de foco/zoom.", erro);
    }
}

async function processarCodigoScanner(codigo) {
    if (scannerTravado) return;

    const numeroLido = somenteDigitos(codigo);
    const numeroSemPrefixo = removerPrefixoSegurancaPatrimonio(numeroLido);

    if (!leituraCameraCompleta(numeroLido)) {
        scannerTravado = true;
        mostrarStatusLeitura("Leitura incompleta", "aviso");

        setTimeout(() => {
            scannerTravado = false;
        }, 1200);
        return;
    }

    scannerTravado = true;
    document.getElementById("campopatrimonio").value = numeroSemPrefixo;
    await buscarpatrimonio();

    setTimeout(() => {
        scannerTravado = false;
    }, 2000);
}

function pararScanner() {
    if (!scanner) {
        document.getElementById("btnAbrirScanner").disabled = false;
        scannerTravado = false;
        mostrarAreaScanner(false);
        limparMensagemCameraAberta();
        return;
    }

    scanner.stop().then(() => {
        scanner.clear();
        scanner = null;
        scannerTravado = false;
        document.getElementById("btnAbrirScanner").disabled = false;
        mostrarAreaScanner(false);
        limparMensagemCameraAberta();
    }).catch(erro => {
        console.error(erro);
        scanner = null;
        scannerTravado = false;
        document.getElementById("btnAbrirScanner").disabled = false;
        mostrarAreaScanner(false);
        limparMensagemCameraAberta();
    });
}

function limparMensagemCameraAberta() {
    const msg = document.getElementById("mensagem");
    if (msg.textContent === "Câmera traseira aberta." || msg.textContent === "Abrindo câmera...") {
        mostrarMensagem("mensagem", "Câmera fechada.", "aviso");
    }
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

async function exportarRelatorioOperador() {
    const sessao = getSessaoAtual();
    const local = getLocalAtual();
    const tipo = document.getElementById("tipoRelatorioOperador").value;
    const abrangencia = document.getElementById("abrangenciaRelatorioOperador").value;

    if (!sessao || (abrangencia === "local" && !local)) {
        mostrarMensagem("mensagemRelatorioOperador", "Selecione a lotação e o local antes de exportar.", "erro");
        return;
    }

    try {
        mostrarMensagem("mensagemRelatorioOperador", "Gerando relatório...", "aviso");

        const relatorio = tipo === "transferencias"
            ? await montarRelatorioTransferenciasOperador(sessao, local, abrangencia)
            : tipo === "naoCadastrados"
                ? await montarRelatorioNaoCadastradosOperador(sessao, local, abrangencia)
            : tipo === "contagens"
                ? await montarRelatorioContagensOperador(sessao, local, abrangencia)
            : await montarRelatorioPatrimoniosOperador(sessao, local, abrangencia, tipo);

        if (!relatorio.linhas.length) {
            mostrarMensagem("mensagemRelatorioOperador", "Nenhum registro encontrado para este relatório.", "aviso");
            return;
        }

        exportarExcel(relatorio);
        mostrarMensagem("mensagemRelatorioOperador", `Relatório exportado com ${relatorio.linhas.length} registro(s).`, "sucesso");
    } catch (erro) {
        console.error(erro);
        mostrarMensagem("mensagemRelatorioOperador", "Erro ao gerar o relatório.", "erro");
    }
}

async function registrarContagemSemLeitura() {
    const sessao = getSessaoAtual();
    const local = getLocalAtual();
    const responsavel = document.getElementById("campoUsuario").value.trim();
    const tipo = normalizarTexto(document.getElementById("tipoItemContagem").value);
    const quantidade = Number(document.getElementById("quantidadeContagem").value);
    const observacao = normalizarTexto(document.getElementById("observacaoContagem").value);

    if (!sessao || !local) {
        mostrarMensagem("mensagemContagem", "Selecione a lotação e o local antes de registrar.", "erro");
        return;
    }

    if (!responsavel) {
        mostrarMensagem("mensagemContagem", "Digite o nome do responsável.", "erro");
        document.getElementById("campoUsuario").focus();
        return;
    }

    if (!tipo) {
        mostrarMensagem("mensagemContagem", "Informe o tipo do item.", "erro");
        document.getElementById("tipoItemContagem").focus();
        return;
    }

    if (!Number.isInteger(quantidade) || quantidade < 1) {
        mostrarMensagem("mensagemContagem", "Informe uma quantidade válida.", "erro");
        document.getElementById("quantidadeContagem").focus();
        return;
    }

    try {
        await contagensColecao.add({
            sessao,
            local,
            tipo,
            quantidade,
            observacao,
            responsavel,
            motivo: "Contagem visual sem leitura de patrimônio.",
            criadoEm: firebase.firestore.FieldValue.serverTimestamp()
        });

        document.getElementById("tipoItemContagem").value = "";
        document.getElementById("quantidadeContagem").value = "";
        document.getElementById("observacaoContagem").value = "";
        mostrarMensagem("mensagemContagem", "Contagem registrada.", "sucesso");
    } catch (erro) {
        console.error(erro);
        mostrarMensagem("mensagemContagem", "Erro ao registrar a contagem.", "erro");
    }
}

async function montarRelatorioPatrimoniosOperador(sessao, local, abrangencia, tipo) {
    const snapshot = await colecao.where("sessao", "==", sessao).get();
    let itens = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    itens = itens.filter(item => {
        if (abrangencia === "local" && item.local !== local) return false;
        if (tipo === "pendentes" && item.status === "conferido") return false;
        if (tipo === "conferidos" && item.status !== "conferido") return false;
        return true;
    });

    ordenarPorNumero(itens);

    return {
        nome: `Relatório ${nomeTipoRelatorioOperador(tipo)} - ${sessao}`,
        colunas: ["Lotação", "Local", "Patrimônio", "Patrimônio antigo", "Descrição", "Marca", "Status", "Responsável", "Data da conferência"],
        linhas: itens.map(item => ({
            "Lotação": item.sessao || "",
            "Local": item.local || "",
            "Patrimônio": item.numero || "",
            "Patrimônio antigo": item.patAntigo || "",
            "Descrição": item.descricao || "",
            "Marca": item.marca || "",
            "Status": item.status === "conferido" ? "Conferido" : "Pendente",
            "Responsável": item.usuario || "",
            "Data da conferência": formatarData(item.conferidoEm)
        }))
    };
}

async function montarRelatorioTransferenciasOperador(sessao, local, abrangencia) {
    const snapshot = await transferenciasColecao.where("lotacaoEncontrada", "==", sessao).get();
    let itens = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    if (abrangencia === "local") {
        itens = itens.filter(item => item.localEncontrado === local);
    }

    itens.sort((a, b) => dataParaMillis(b.ultimaLeituraEm || b.primeiraLeituraEm) - dataParaMillis(a.ultimaLeituraEm || a.primeiraLeituraEm));

    return {
        nome: `Itens a transferir - ${sessao}`,
        colunas: [
            "Patrimônio",
            "Patrimônio antigo",
            "Descrição",
            "Marca",
            "Lotação cadastrada",
            "Local cadastrado",
            "Lotação encontrada",
            "Local encontrado",
            "Responsável",
            "Data da leitura",
            "Situação"
        ],
        linhas: itens.map(item => ({
            "Patrimônio": item.numero || item.numeroSemPrefixo || item.numeroInformado || "",
            "Patrimônio antigo": item.patAntigo || "",
            "Descrição": item.descricao || "",
            "Marca": item.marca || "",
            "Lotação cadastrada": item.lotacaoCadastrada || "",
            "Local cadastrado": item.localCadastrado || "",
            "Lotação encontrada": item.lotacaoEncontrada || "",
            "Local encontrado": item.localEncontrado || "",
            "Responsável": item.responsavel || "",
            "Data da leitura": formatarData(item.ultimaLeituraEm || item.primeiraLeituraEm),
            "Situação": item.status || "Transferência pendente"
        }))
    };
}

async function montarRelatorioNaoCadastradosOperador(sessao, local, abrangencia) {
    const snapshot = await naoCadastradosColecao.where("sessao", "==", sessao).get();
    let itens = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    if (abrangencia === "local") {
        itens = itens.filter(item => item.local === local);
    }

    itens.sort((a, b) => dataParaMillis(b.ultimaLeituraEm || b.primeiraLeituraEm) - dataParaMillis(a.ultimaLeituraEm || a.primeiraLeituraEm));

    return {
        nome: `Não consta na base - ${sessao}`,
        colunas: ["Lotação", "Local", "Patrimônio informado", "Sem prefixo 67", "Responsável", "Data da leitura", "Situação"],
        linhas: itens.map(item => ({
            "Lotação": item.sessao || "",
            "Local": item.local || "",
            "Patrimônio informado": item.numeroInformado || "",
            "Sem prefixo 67": item.numeroSemPrefixo || "",
            "Responsável": item.usuario || "",
            "Data da leitura": formatarData(item.ultimaLeituraEm || item.primeiraLeituraEm),
            "Situação": item.status || "Não consta na base"
        }))
    };
}

async function montarRelatorioContagensOperador(sessao, local, abrangencia) {
    const snapshot = await contagensColecao.where("sessao", "==", sessao).get();
    let itens = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    if (abrangencia === "local") {
        itens = itens.filter(item => item.local === local);
    }

    itens.sort((a, b) => dataParaMillis(b.criadoEm) - dataParaMillis(a.criadoEm));

    return {
        nome: `Contagem sem leitura - ${sessao}`,
        colunas: ["Lotação", "Local", "Tipo do item", "Quantidade", "Observação", "Responsável", "Data"],
        linhas: itens.map(item => ({
            "Lotação": item.sessao || "",
            "Local": item.local || "",
            "Tipo do item": item.tipo || "",
            "Quantidade": item.quantidade || "",
            "Observação": item.observacao || "",
            "Responsável": item.responsavel || "",
            "Data": formatarData(item.criadoEm)
        }))
    };
}

function exportarExcel(relatorio) {
    const planilha = XLSX.utils.json_to_sheet(relatorio.linhas, { header: relatorio.colunas });
    const arquivo = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(arquivo, planilha, "Relatório");
    XLSX.writeFile(arquivo, `${normalizarNomeArquivo(relatorio.nome)}.xlsx`);
}

function nomeTipoRelatorioOperador(tipo) {
    const nomes = {
        pendentes: "de pendentes",
        conferidos: "de conferidos",
        todos: "completo"
    };

    return nomes[tipo] || "do local";
}

function formatarData(valor) {
    if (!valor) return "";
    const data = valor.toDate ? valor.toDate() : new Date(valor);
    if (Number.isNaN(data.getTime())) return "";
    return data.toLocaleString("pt-BR");
}

function dataParaMillis(valor) {
    if (!valor) return 0;
    const data = valor.toDate ? valor.toDate() : new Date(valor);
    return Number.isNaN(data.getTime()) ? 0 : data.getTime();
}

function somenteDigitos(valor) {
    return String(valor || "").replace(/\D/g, "").trim();
}

function removerZerosAEsquerda(valor) {
    const numero = somenteDigitos(valor);
    return numero.replace(/^0+/, "") || "0";
}

function removerPrefixoSegurancaPatrimonio(valor) {
    const numero = somenteDigitos(valor);

    if (numero.startsWith(PREFIXO_SEGURANCA_PATRIMONIO) && numero.length > PREFIXO_SEGURANCA_PATRIMONIO.length) {
        return numero.slice(PREFIXO_SEGURANCA_PATRIMONIO.length);
    }

    return numero;
}

function leituraCameraCompleta(valor) {
    const numero = somenteDigitos(valor);
    return numero.startsWith(PREFIXO_SEGURANCA_PATRIMONIO) && numero.length > PREFIXO_SEGURANCA_PATRIMONIO.length;
}

function gerarNumerosBuscaPatrimonio(valor) {
    const numero = somenteDigitos(valor);
    const semPrefixo = removerPrefixoSegurancaPatrimonio(numero);

    return Array.from(new Set([
        numero,
        semPrefixo,
        removerZerosAEsquerda(numero),
        removerZerosAEsquerda(semPrefixo)
    ].filter(Boolean)));
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

function criarIdNaoCadastrado(sessao, local, numero) {
    return [sessao, local, somenteDigitos(numero)]
        .map(parte => normalizarChaveLocal(parte).replace(/[^a-z0-9]+/g, "-"))
        .join("__");
}

function criarIdTransferencia(lotacaoCadastrada, localCadastrado, lotacaoEncontrada, localEncontrado, numero) {
    return [lotacaoCadastrada, localCadastrado, lotacaoEncontrada, localEncontrado, somenteDigitos(numero)]
        .map(parte => normalizarChaveLocal(parte).replace(/[^a-z0-9]+/g, "-"))
        .join("__");
}

function normalizarNomeArquivo(valor) {
    return normalizarChave(valor).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "relatorio";
}

function carregarEstadoOperador() {
    try {
        return JSON.parse(localStorage.getItem(CHAVE_ESTADO_OPERADOR)) || {};
    } catch (erro) {
        return {};
    }
}

function salvarEstadoOperador() {
    const estado = {
        usuario: document.getElementById("campoUsuario")?.value.trim() || "",
        sessao: getSessaoAtual(),
        local: getLocalAtual()
    };

    estadoOperador = estado;
    localStorage.setItem(CHAVE_ESTADO_OPERADOR, JSON.stringify(estado));
}

function mostrarStatusLeitura(texto, tipo) {
    const status = document.getElementById("statusLeitura");
    if (!status) return;
    status.textContent = texto;
    status.className = `mensagem status-leitura ${tipo}`;
}

function vibrar() {
    if (navigator.vibrate) navigator.vibrate(200);
}

function mostrarMensagem(id, texto, tipo) {
    const msg = document.getElementById(id);
    msg.textContent = texto;
    msg.className = `mensagem ${tipo}`;
}



