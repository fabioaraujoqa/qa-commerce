const express = require("express");
const bodyParser = require("body-parser");
const db = require("../config/db"); // Certifique-se de que este caminho está correto
const bcrypt = require("bcrypt");
const Joi = require("joi");
const swaggerUi = require("swagger-ui-express");
const swaggerDocument = require("../config/swagger.json");
const path = require("path");
const app = express();
const port = 3000;

// Middleware
app.use(bodyParser.json());
app.use(express.static("public")); // Servir frontend estático

// Documentação Swagger
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerDocument));

// Esquema de validação usando Joi
const checkoutSchema = Joi.object({
  userId: Joi.number().optional(), // Torna userId opcional
  firstName: Joi.string().min(2).max(50).required(),
  lastName: Joi.string().min(2).max(50).required(),
  address: Joi.string().min(5).max(100).required(),
  number: Joi.string().min(1).max(10).required(),
  cep: Joi.string().length(8).required(),
  phone: Joi.string().min(10).max(15).allow(""), // Telefone não obrigatório
  email: Joi.string().email().required(),
  paymentMethod: Joi.string().valid("credit_card", "boleto", "pix").required(),
  cardNumber: Joi.string().when("paymentMethod", {
    is: "credit_card",
    then: Joi.string().length(16).allow(null).optional(),
    otherwise: Joi.allow(null).optional(),
  }),
  cardExpiry: Joi.string().when("paymentMethod", {
    is: "credit_card",
    then: Joi.string()
      .pattern(/^(0[1-9]|1[0-2])\/?([0-9]{4}|[0-9]{2})$/)
      .allow(null)
      .optional(),
    otherwise: Joi.allow(null).optional(),
  }),
  cardCvc: Joi.string().when("paymentMethod", {
    is: "credit_card",
    then: Joi.string().min(3).max(4).allow(null).optional(),
    otherwise: Joi.allow(null).optional(),
  }),
  boletoCode: Joi.string().when("paymentMethod", {
    is: "boleto",
    then: Joi.string().allow(null).optional(),
    otherwise: Joi.allow(null).optional(),
  }),
  pixKey: Joi.string().when("paymentMethod", {
    is: "pix",
    then: Joi.string().allow(null).optional(),
    otherwise: Joi.allow(null).optional(),
  }),
  createAccount: Joi.boolean().optional(),
  password: Joi.string().min(6).optional(),
});

// Rota para listar produtos com paginação
app.get("/api/produtos", (req, res) => {
  const page = parseInt(req.query.page) || 1; // Página atual
  const limit = parseInt(req.query.limit) || 9; // Limite de produtos por página
  const offset = (page - 1) * limit; // Deslocamento para a consulta

  db.all(
    "SELECT * FROM Products LIMIT ? OFFSET ?",
    [limit, offset],
    (err, rows) => {
      if (err) {
        res.status(500).send("Erro ao buscar produtos.");
      } else {
        // Consultar o total de produtos para calcular o número de páginas
        db.get("SELECT COUNT(*) as total FROM Products", (err, result) => {
          if (err) {
            res.status(500).send("Erro ao calcular o total de produtos.");
          } else {
            const total = result.total;
            const totalPages = Math.ceil(total / limit);
            res.json({
              products: rows,
              totalPages: totalPages,
              currentPage: page,
            });
          }
        });
      }
    }
  );
});

// Ajuste na rota de registro de usuário
app.post("/api/registrar", (req, res) => {
  const { name, email, password } = req.body;
  const saltRounds = 10;

  bcrypt.hash(password, saltRounds, (err, hashedPassword) => {
    if (err) {
      return res.status(500).send("Erro ao registrar usuário.");
    }
    db.run(
      "INSERT INTO Users (name, email, password) VALUES (?, ?, ?)",
      [name, email, hashedPassword],
      function (err) {
        if (err) {
          res.status(500).send("Erro ao registrar usuário.");
        } else {
          res.status(201).send({ id: this.lastID });
        }
      }
    );
  });
});

app.post("/api/checkout", (req, res) => {
  const {
    userId,
    firstName,
    lastName,
    address,
    number,
    cep,
    phone,
    email,
    paymentMethod,
    cardNumber,
    cardExpiry,
    cardCvc,
    boletoCode,
    pixKey,
    createAccount,
    password,
  } = req.body;

  // Validação com Joi
  const { error } = checkoutSchema.validate(req.body);
  if (error) {
    return res.status(400).send(error.details[0].message);
  }

  const shippingFee = 19.9; // Frete fixo

  if (createAccount) {
    // Verificar se o e-mail já está registrado
    db.get("SELECT * FROM Users WHERE email = ?", [email], (err, user) => {
      if (err) {
        return res.status(500).send("Erro ao verificar e-mail.");
      }
      if (user) {
        return res
          .status(400)
          .send("E-mail já registrado. Tente um email diferente");
      }

      // Criar a conta e depois o pedido
      createNewUser();
    });
  } else {
    // Prossiga com a criação do pedido se não estiver criando conta
    processOrder(userId);
  }

  function createNewUser() {
    const saltRounds = 10;
    bcrypt.hash(password, saltRounds, (err, hashedPassword) => {
      if (err) {
        return res.status(500).send("Erro ao criar conta.");
      }

      db.run(
        "INSERT INTO Users (email, password, name) VALUES (?, ?, ?)",
        [email, hashedPassword, `${firstName} ${lastName}`],
        function (err) {
          if (err) {
            return res.status(500).send("Erro ao criar conta.");
          }

          // Use o novo userId para criar o pedido
          processOrder(this.lastID);
        }
      );
    });
  }

  function processOrder(finalUserId) {
    const query = `
    SELECT Products.price, Cart.quantity FROM Cart 
    JOIN Products ON Cart.product_id = Products.id 
    WHERE Cart.user_id = ?;`;

    db.all(query, [finalUserId], (err, rows) => {
      if (err) {
        return res.status(500).send("Erro ao calcular total do pedido.");
      }

      const totalPrice =
        rows.reduce((total, item) => total + item.price * item.quantity, 0) +
        shippingFee;

      const initialStatus = 'Aguardando pagamento'; // Status inicial

      db.run(
        `
            INSERT INTO Orders (
                user_id, first_name, last_name, address, number, cep, phone, email,
                payment_method, card_number, card_expiry, card_cvc, boleto_code, pix_key, total_price, status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          finalUserId,
          firstName,
          lastName,
          address,
          number,
          cep,
          phone,
          email,
          paymentMethod,
          cardNumber || null,
          cardExpiry || null,
          cardCvc || null,
          boletoCode || null,
          pixKey || null,
          totalPrice,
          initialStatus, // Usa o status inicial aqui
        ],
        function (err) {
          if (err) {
            return res.status(500).send("Erro ao finalizar pedido.");
          }

          const orderId = this.lastID;
          const orderNumber = `${orderId}-${
            Math.floor(Math.random() * 9000) + 1000
          }`;

          db.run(
            "UPDATE Orders SET order_number = ? WHERE id = ?",
            [orderNumber, orderId],
            function (err) {
              if (err) {
                return res
                  .status(500)
                  .send("Erro ao atualizar número do pedido.");
              }

              // Limpar o carrinho após a conclusão do pedido
              db.run(
                "DELETE FROM Cart WHERE user_id = ?",
                [finalUserId],
                function (err) {
                  if (err) {
                    return res.status(500).send("Erro ao limpar o carrinho.");
                  }
                  scheduleOrderStatusUpdate(orderId);

                  res.status(201).send({ id: orderId, orderNumber });

                  setTimeout(() => {
                    updateOrderStatus(orderId);
                  }, 60000); // 2 minutos em milissegundos
                }
              );
            }
          );
        }
      );
    });
  }

  function updateOrderStatus(orderId) {
    db.run(
      "UPDATE Orders SET status = ? WHERE id = ?",
      ['Pagamento aprovado', orderId],
      function (err) {
        if (err) {
          console.error("Erro ao atualizar status do pedido:", err);
        } else {
          console.log(`Status do pedido ${orderId} atualizado para Pagamento aprovado.`);
        }
      }
    );
  }
  
  // Função para agendar a atualização do status do pedido
  function scheduleOrderStatusUpdate(orderId) {
    const nextStatus = "Pagamento aprovado"; // Próximo status após o atraso

    setTimeout(() => {
      fetch("http://localhost:3000/api/atualizar-status", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ orderId, nextStatus }),
      }).catch((error) =>
        console.error("Erro ao atualizar status do pedido:", error)
      );
    }, 2 * 60 * 1000); // Atraso de 2 minutos
  }
});

//Endpoint para atualizar o status do pedido

app.post('/api/atualizar-status', (req, res) => {
  const { orderId, nextStatus } = req.body;
  db.run(
    'UPDATE Orders SET status = ? WHERE id = ? AND user_id = ?',
    [nextStatus, orderId, userId],
    function (err) {
      if (err) {
        return res.status(500).send('Erro ao atualizar o status do pedido.');
      }
      res.status(200).send({ message: 'Status atualizado com sucesso.' });
    }
  );
});

// Limpar o carrinho para um usuário específico
app.post("/api/limpar-carrinho", (req, res) => {
  const { userId } = req.body;
  db.run("DELETE FROM Cart WHERE user_id = ?", [userId], function (err) {
    if (err) {
      res.status(500).send("Erro ao limpar o carrinho.");
    } else {
      res.status(200).send({ message: "Carrinho limpo com sucesso." });
    }
  });
});

// Rota para adicionar produtos ao carrinho
app.post("/api/carrinho", (req, res) => {
  const { userId, productId, quantity } = req.body;

  db.get(
    "SELECT * FROM Cart WHERE user_id = ? AND product_id = ?",
    [userId, productId],
    (err, row) => {
      if (err) {
        res.status(500).send("Erro ao buscar produto no carrinho.");
      } else if (row) {
        db.run(
          "UPDATE Cart SET quantity = quantity + ? WHERE user_id = ? AND product_id = ?",
          [quantity, userId, productId],
          function (err) {
            if (err) {
              res
                .status(500)
                .send("Erro ao atualizar quantidade do produto no carrinho.");
            } else {
              res
                .status(200)
                .send({ message: "Quantidade atualizada no carrinho." });
            }
          }
        );
      } else {
        db.run(
          "INSERT INTO Cart (user_id, product_id, quantity) VALUES (?, ?, ?)",
          [userId, productId, quantity],
          function (err) {
            if (err) {
              res.status(500).send("Erro ao adicionar produto ao carrinho.");
            } else {
              res.status(201).send({ id: this.lastID });
            }
          }
        );
      }
    }
  );
});

// Rota para listar produtos no carrinho
app.get("/api/carrinho/:userId", (req, res) => {
  const userId = req.params.userId;
  db.all(
    "SELECT Products.id as productId, Products.name, Products.price, Cart.quantity FROM Cart JOIN Products ON Cart.product_id = Products.id WHERE Cart.user_id = ?",
    [userId],
    (err, rows) => {
      if (err) {
        res.status(500).send("Erro ao buscar produtos no carrinho.");
      } else {
        res.json(rows);
      }
    }
  );
});

// Rota para deletar produtos no carrinho
app.delete("/api/carrinho/:userId/:productId", (req, res) => {
  const userId = req.params.userId;
  const productId = req.params.productId;
  db.run(
    "DELETE FROM Cart WHERE user_id = ? AND product_id = ?",
    [userId, productId],
    function (err) {
      if (err) {
        res.status(500).send("Erro ao remover produto do carrinho.");
      } else if (this.changes === 0) {
        res.status(404).send("Produto não encontrado no carrinho.");
      } else {
        res.status(200).send({ message: "Produto removido do carrinho." });
      }
    }
  );
});

// Rota para obter detalhes de um produto específico
app.get("/api/produtos/:id", (req, res) => {
  const productId = req.params.id;
  db.get("SELECT * FROM Products WHERE id = ?", [productId], (err, row) => {
    if (err) {
      res.status(500).send("Erro ao buscar detalhes do produto.");
    } else if (!row) {
      res.status(404).send("Produto não encontrado.");
    } else {
      res.json(row);
    }
  });
});

// Rota para obter status do pedido
app.get("/api/orders/:orderId", (req, res) => {
  const orderId = req.params.orderId;
  db.get("SELECT * FROM Orders WHERE id = ?", [orderId], (err, row) => {
    if (err) {
      return res.status(500).send("Erro ao buscar status do pedido.");
    }

    if (!row) {
      return res.status(404).send("Pedido não encontrado.");
    }

    const formattedOrderId = `${row.id}-${
      Math.floor(Math.random() * 9000) + 1000
    }`;
    res.json({
      ...row,
      formattedOrderId,
    });
  });
});

// Rota para login
app.post("/api/login", (req, res) => {
  const { email, password } = req.body;
  db.get("SELECT * FROM Users WHERE email = ?", [email], (err, user) => {
    if (err || !user) {
      return res.status(401).send({ error: "Email ou senha incorretos." });
    }

    bcrypt.compare(password, user.password, (err, result) => {
      if (err || !result) {
        return res.status(401).send({ error: "Email ou senha incorretos." });
      }

      res.json({ id: user.id, name: user.name });
    });
  });
});

// Rota para obter pedidos de um usuário
app.get("/api/orders", (req, res) => {
  const userId = req.query.userId;
  db.all("SELECT * FROM Orders WHERE user_id = ?", [userId], (err, rows) => {
    if (err) {
      res.status(500).send("Erro ao buscar pedidos.");
    } else {
      const orders = rows.map((order) => {
        const formattedOrderId = `${order.id}-${
          Math.floor(Math.random() * 9000) + 1000
        }`;
        return { ...order, formattedOrderId };
      });
      res.json(orders);
    }
  });
});

// Nova rota para buscar o último pedido do usuário
app.get("/api/ultimo-pedido/:userId", (req, res) => {
  const userId = req.params.userId;

  db.get(
    `
        SELECT Orders.*, Users.name
        FROM Orders
        JOIN Users ON Orders.user_id = Users.id
        WHERE Orders.user_id = ?
        ORDER BY Orders.id DESC
        LIMIT 1
    `,
    [userId],
    (err, row) => {
      if (err) {
        res.status(500).send("Erro ao buscar o último pedido.");
      } else if (!row) {
        res.status(404).send("Nenhum pedido encontrado.");
      } else {
        res.json(row);
      }
    }
  );
});

// Endpoint para simular a atualização do status do pedido após 2 minutos
app.post("/api/atualizar-status", (req, res) => {
  const { orderId, nextStatus } = req.body;
  db.run(
    "UPDATE Orders SET status = ? WHERE id = ?",
    [nextStatus, orderId],
    function (err) {
      if (err) {
        return res.status(500).send("Erro ao atualizar o status do pedido.");
      }
      res.status(200).send({ message: "Status atualizado com sucesso." });
    }
  );
});

// Rota para simular a atualização do status do pedido após 2 minutos
app.put("/api/orders/:orderId/update-status", (req, res) => {
  const orderId = req.params.orderId;
  const { status } = req.body;

  db.run(
    "UPDATE Orders SET status = ? WHERE id = ?",
    [status, orderId],
    function (err) {
      if (err) {
        return res.status(500).send("Erro ao atualizar status do pedido.");
      }
      res.status(200).send("Status atualizado com sucesso.");
    }
  );
});

// Servir arquivos estáticos HTML diretamente
app.get("/dashboard.html", (req, res) => {
  res.sendFile(path.join(__dirname, "../public/dashboard.html"));
});

app.listen(port, async () => {
  console.log(`Servidor rodando em http://localhost:${port}`);
  console.log(`Documentação rodando em http://localhost:${port}/api-docs`);
});
