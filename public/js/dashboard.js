document.addEventListener('DOMContentLoaded', function () {
    const orderId = new URLSearchParams(window.location.search).get('orderId');
    const countdownElement = document.getElementById('countdown');
    const statusMessageElement = document.getElementById('status-message');
    let countdown = 60; // 2 minutos em segundos

    function updateCountdown() {
        countdownElement.textContent = countdown;
        if (countdown > 0) {
            countdown--;
            setTimeout(updateCountdown, 1000);
        } else {
            verificarStatusPedido();
        }
    }

    function verificarStatusPedido() {
        fetch(`/api/orders/${orderId}`)
            .then(response => response.json())
            .then(data => {
                if (data.status === 'Pagamento aprovado') {
                    document.getElementById('order-status').textContent = 'Pagamento aprovado';
                    statusMessageElement.textContent = 'Status: Pagamento aprovado';
                } else {
                    document.getElementById('order-status').textContent = 'Aguardando Pagamento';
                    statusMessageElement.textContent = 'Nova verificação do status em 60 segundos.';
                    // Reinicia o contador para verificar novamente após 2 minutos
                    countdown = 60;
                    updateCountdown();
                }
            })
            .catch(error => {
                console.error('Erro ao verificar o status do pedido:', error);
                statusMessageElement.textContent = 'Erro ao verificar o status. Tentando novamente em 2 minutos.';
                // Reinicia o contador em caso de erro
                countdown = 60;
                updateCountdown();
            });
    }

    // Inicia o contador
    updateCountdown();

    const user = JSON.parse(sessionStorage.getItem('user'));
    if (user) {
        document.getElementById('user-name').textContent = user.name;
        fetchUltimoPedido(user.id);
    } else {
        // Redireciona para a página de login se o usuário não estiver autenticado
        window.location.href = '/login.html';
    }

    document.getElementById('logout-button').addEventListener('click', function() {
        sessionStorage.removeItem('user');
        window.location.href = '/login.html';
    });

    function fetchUltimoPedido(userId) {
        fetch(`/api/ultimo-pedido/${userId}`)
            .then(response => response.json())
            .then(data => {
                if (data.error) {
                    showError(data.error);
                } else {
                    displayOrderDetails(data);
                    checkAndSetOrderStatus(data);
                }
            })
            .catch(err => showError('Erro ao buscar o último pedido.'));
    }

    function displayOrderDetails(order) {
        document.getElementById('order-id').textContent = order.order_number;
        document.getElementById('order-total').textContent = `R$ ${order.total_price.toFixed(2)}`;
        document.getElementById('order-status').textContent = order.status;
    }

    function showError(message) {
        const errorContainer = document.getElementById('error-container');
        errorContainer.classList.remove('d-none');
        errorContainer.textContent = message;
    }

    function checkAndSetOrderStatus(order) {
        if (order.status === 'Aguardando Pagamento') {
            document.getElementById('status-message').textContent = 'Nova verificação do status em 60 segundos.';
            countdown = 60;
            updateCountdown();
        }
    }
});
