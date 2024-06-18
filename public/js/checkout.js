document.addEventListener('DOMContentLoaded', function () {
    const paymentCard = document.getElementById('payment-card');
    const paymentBoleto = document.getElementById('payment-boleto');
    const paymentPix = document.getElementById('payment-pix');
    const cardDetails = document.getElementById('card-details');
    const boletoDetails = document.getElementById('boleto-details');
    const pixDetails = document.getElementById('pix-details');
    const boletoCode = document.getElementById('boleto-code');
    const pixKey = document.getElementById('pix-key');
    const createAccountCheckbox = document.getElementById('create-account');
    const passwordFields = document.getElementById('password-fields');
    const form = document.getElementById('checkout-form');
    const alertContainer = document.getElementById('alert-container');

    // Função para gerar um código de boleto falso
    function generateBoletoCode() {
        return '23793.38128 60082.677139 66003.996498 1 89440000010000';
    }

    // Função para gerar uma chave Pix falsa
    function generatePixDetails() {
        return {
            key: '123e4567-e89b-12d3-a456-426614174000',
        };
    }

    // Mostrar campos com base na seleção de pagamento
    paymentCard.addEventListener('change', function () {
        cardDetails.classList.remove('d-none');
        boletoDetails.classList.add('d-none');
        pixDetails.classList.add('d-none');
    });

    paymentBoleto.addEventListener('change', function () {
        cardDetails.classList.add('d-none');
        boletoDetails.classList.remove('d-none');
        pixDetails.classList.add('d-none');
        boletoCode.textContent = generateBoletoCode();
    });

    paymentPix.addEventListener('change', function () {
        cardDetails.classList.add('d-none');
        boletoDetails.classList.add('d-none');
        pixDetails.classList.remove('d-none');
        const pixData = generatePixDetails();
        pixKey.textContent = pixData.key;
    });

    createAccountCheckbox.addEventListener('change', function () {
        passwordFields.classList.toggle('d-none', !this.checked);
    });

    form.addEventListener('submit', function (event) {
        event.preventDefault();
        clearValidationMessages();

        const requiredFields = ['first-name', 'last-name', 'address', 'number', 'cep', 'email'];
        let hasErrors = false;

        // Verificar campos obrigatórios
        requiredFields.forEach(fieldId => {
            const field = document.getElementById(fieldId);
            if (!field.value.trim()) {
                hasErrors = true;
                showError(field, 'Este campo é obrigatório.');
            }
        });

        const emailField = document.getElementById('email');
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(emailField.value)) {
            hasErrors = true;
            showError(emailField, 'Por favor, insira um email válido.');
        }

        const cepField = document.getElementById('cep');
        if (cepField.value.length !== 8) {
            hasErrors = true;
            showError(cepField, 'O CEP deve ter 8 caracteres.');
        }

        if (createAccountCheckbox.checked) {
            const password = document.getElementById('password').value;
            const confirmPassword = document.getElementById('confirm-password').value;
            const passwordRegex = /^(?=.*[A-Z])(?=.*[!@#$%^&*])[A-Za-z\d!@#$%^&*]{6,}$/;

            if (!passwordRegex.test(password)) {
                hasErrors = true;
                showError(document.getElementById('password'), 'A senha deve conter no mínimo 6 caracteres, incluindo uma letra maiúscula e um caractere especial.');
            }

            if (password !== confirmPassword) {
                hasErrors = true;
                showError(document.getElementById('confirm-password'), 'As senhas não coincidem.');
            }
        }

        let paymentMethod = document.querySelector('input[name="payment-method"]:checked');
        if (!paymentMethod) {
            hasErrors = true;
            showAlert('Você deve selecionar uma forma de pagamento.');
        } else {
            paymentMethod = paymentMethod.value;
        }
        
        if (paymentMethod === 'credit_card') {
            const cardFields = ['card-number', 'card-expiry', 'card-cvc'];
            cardFields.forEach(fieldId => {
                const field = document.getElementById(fieldId);
                if (!field.value.trim()) {
                    hasErrors = true;
                    showError(field, 'Este campo é obrigatório.');
                }
            });
        }

        if (!document.getElementById('terms').checked) {
            showAlert('Você deve concordar com os termos e condições.');
            return;
        }

        if (hasErrors) {
            showAlert('Por favor, preencha todos os campos obrigatório marcados com asteriscos!');
            return;
        }

        const userId = 1; // Ou obtenha o ID do usuário logado de um estado global ou do localStorage
        const formData = {
            userId: userId,
            firstName: document.getElementById('first-name').value,
            lastName: document.getElementById('last-name').value,
            address: document.getElementById('address').value,
            number: document.getElementById('number').value,
            cep: document.getElementById('cep').value,
            phone: document.getElementById('phone').value,
            email: document.getElementById('email').value,
            paymentMethod: paymentMethod,
            createAccount: createAccountCheckbox.checked,
            cardNumber: paymentMethod === 'card' ? document.getElementById('card-number').value : null,
            cardExpiry: paymentMethod === 'card' ? document.getElementById('card-expiry').value : null,
            cardCvc: paymentMethod === 'card' ? document.getElementById('card-cvc').value : null,
            boletoCode: paymentMethod === 'boleto' ? boletoCode.textContent : null,
            pixKey: paymentMethod === 'pix' ? pixKey.textContent : null,
        };

        if (formData.createAccount) {
            formData.password = document.getElementById('password').value;
        }

        fetch('/api/checkout', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(formData)
        })
        .then(response => {
            if (!response.ok) {
                return response.text().then(text => { throw new Error(text); });
            }
            return response.json();
        })
        .then(data => {
            window.location.href = `/status.html?orderId=${data.id}`;
        })
        .catch(error => {
            showAlert(error.message);
        });
    });

    function showError(element, message) {
        const errorMessage = document.createElement('div');
        errorMessage.classList.add('invalid-feedback');
        errorMessage.textContent = message;
        element.parentNode.appendChild(errorMessage);
        element.classList.add('is-invalid');
    }

    function showAlert(message) {
        alertContainer.classList.remove('d-none');
        alertContainer.innerHTML = `<p>${message}</p>`;
        window.scrollTo(0, 0);
    }

    function clearValidationMessages() {
        document.querySelectorAll('.is-invalid').forEach(element => {
            element.classList.remove('is-invalid');
        });
        document.querySelectorAll('.invalid-feedback').forEach(element => {
            element.remove();
        });
        alertContainer.classList.add('d-none');
    }
});

document.addEventListener("DOMContentLoaded", function () {
    const checkoutForm = document.getElementById("checkout-form");
  
    checkoutForm.addEventListener("submit", function (event) {
      event.preventDefault();
  
      const userId = localStorage.getItem("userId") || null; // Recupera o userId do armazenamento local
      const formData = new FormData(checkoutForm);
  
      const requestBody = {
        userId: userId ? parseInt(userId, 10) : null, // Converte para número ou usa null
        firstName: formData.get("firstName"),
        lastName: formData.get("lastName"),
        address: formData.get("address"),
        number: formData.get("number"),
        cep: formData.get("cep"),
        phone: formData.get("phone"),
        email: formData.get("email"),
        paymentMethod: formData.get("paymentMethod"),
        cardNumber: formData.get("cardNumber"),
        cardExpiry: formData.get("cardExpiry"),
        cardCvc: formData.get("cardCvc"),
        boletoCode: formData.get("boletoCode"),
        pixKey: formData.get("pixKey"),
        createAccount: formData.get("createAccount") === "on",
        password: formData.get("password"),
      };
  
      fetch("/api/checkout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
      })
        .then((response) => response.json())
        .then((data) => {
          if (data.error) {
            alert(data.error);
          } else {
            window.location.href = `/status.html?orderId=${data.id}`;
          }
        })
        .catch((error) => console.error("Erro ao finalizar compra:", error));
    });
    function obterUserId() {
        // Lógica para obter o userId, por exemplo, do armazenamento local ou de uma variável global
        return localStorage.getItem('userId') || null;
      }
     
  });

  
  
