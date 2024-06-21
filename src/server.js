const express = require("express");
const bodyParser = require("body-parser");
const db = require("../config/db"); 
const bcrypt = require("bcrypt");
const jwt = require('jsonwebtoken');
const SECRET_KEY = process.env.JWT_SECRET || 'admin@admin'; // Use uma variável de ambiente para isso em produção
const Joi = require("joi");
const swaggerUi = require("swagger-ui-express");
const swaggerDocument = require("../config/swagger.json");
const { authenticateAdmin } = require('../middleware/auth');
const path = require("path");
const app = express();
const port = 3000;

// Middleware
app.use(bodyParser.json());
app.use(express.static("public")); // Servir frontend estático

// Middleware de autenticação
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) return res.status(401).send("Token não fornecido.");

  jwt.verify(token, SECRET_KEY, (err, user) => {
      if (err) return res.status(403).send("Token inválido.");
      req.user = user;
      next();
  });
}

// Middleware para verificar se é admin
function isAdmin(req, res, next) {
  if (!req.user.isAdmin) {
      return res.status(403).send("Acesso negado. Apenas administradores.");
  }
  next();
}

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
      .allow(null).optional(),
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

// Rota de checkout

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
        return res.status(400).send("E-mail já registrado. Tente um email diferente");
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
          "Pagamento aprovado",
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
                return res.status(500).send("Erro ao atualizar número do pedido.");
              }

              // Limpar o carrinho após a conclusão do pedido
              db.run("DELETE FROM Cart WHERE user_id = ?", [finalUserId], function (err) {
                if (err) {
                  return res.status(500).send("Erro ao limpar o carrinho.");
                }
                res.status(201).send({ id: orderId, orderNumber });
              });
            }
          );
        }
      );
    });
  }
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

// Servir arquivos estáticos HTML diretamente
app.get("/dashboard.html", (req, res) => {
  res.sendFile(path.join(__dirname, "../public/dashboard.html"));
});

app.put('/api/users/:id', authenticateAdmin, (req, res) => {
  const { id } = req.params;
  const { name, email, password } = req.body;

  if (password) {
      bcrypt.hash(password, 10, (err, hashedPassword) => {
          if (err) {
              return res.status(500).send("Erro ao hashear a senha.");
          }

          db.run("UPDATE Users SET name = ?, email = ?, password = ? WHERE id = ?", [name, email, hashedPassword, id], function (err) {
              if (err) {
                  return res.status(500).send("Erro ao atualizar o usuário.");
              }
              res.send("Usuário atualizado com sucesso.");
          });
      });
  } else {
      db.run("UPDATE Users SET name = ?, email = ? WHERE id = ?", [name, email, id], function (err) {
          if (err) {
              return res.status(500).send("Erro ao atualizar o usuário.");
          }
          res.send("Usuário atualizado com sucesso.");
      });
  }
});

app.delete('/api/users/:id', authenticateAdmin, (req, res) => {
  const { id } = req.params;

  db.run("DELETE FROM Users WHERE id = ?", [id], function (err) {
      if (err) {
          return res.status(500).send("Erro ao deletar o usuário.");
      }
      res.send("Usuário deletado com sucesso.");
  });
});

// Rota PUT para atualizar itens no carrinho
app.put('/api/cart/:id', (req, res) => {
  const { id } = req.params;
  const { quantity } = req.body;

  db.run("UPDATE Cart SET quantity = ? WHERE id = ?", [quantity, id], function (err) {
      if (err) {
          return res.status(500).send("Erro ao atualizar item no carrinho.");
      }
      res.send("Item no carrinho atualizado com sucesso.");
  });
});

// Rota DELETE para remover itens do carrinho
app.delete('/api/cart/:id', (req, res) => {
  const { id } = req.params;

  db.run("DELETE FROM Cart WHERE id = ?", [id], function (err) {
      if (err) {
          return res.status(500).send("Erro ao remover item do carrinho.");
      }
      res.send("Item do carrinho removido com sucesso.");
  });
});

// Endpoint de login
app.post('/api/login', (req, res) => {
  const { email, password } = req.body;

  db.get("SELECT * FROM Users WHERE email = ?", [email], (err, user) => {
      if (err || !user) {
          return res.status(401).send("Email ou senha incorretos.");
      }

      bcrypt.compare(password, user.password, (err, isMatch) => {
          if (err || !isMatch) {
              return res.status(401).send("Email ou senha incorretos.");
          }

          const token = jwt.sign({ id: user.id, isAdmin: user.isAdmin }, SECRET_KEY, { expiresIn: '1h' });
          res.json({ id: user.id, name: user.name, token }); 
      });
  });
});

// Rota POST para criar novos usuários
app.post('/api/users', (req, res) => {
  const { name, email, password, isAdmin } = req.body;

  bcrypt.hash(password, 10, (err, hashedPassword) => {
      if (err) {
          return res.status(500).send("Erro ao hashear a senha.");
      }

      db.run(
          "INSERT INTO Users (name, email, password, isAdmin) VALUES (?, ?, ?, ?)",
          [name, email, hashedPassword, isAdmin ? 1 : 0],
          function (err) {
              if (err) {
                  return res.status(500).send("Erro ao criar usuário.");
              }
              res.send("Usuário criado com sucesso.");
          }
      );
  });
});

// Rota GET para listar todos os usuários
app.get('/api/users', (req, res) => {
  db.all("SELECT id, name, email, isAdmin FROM Users", (err, rows) => {
      if (err) {
          return res.status(500).send("Erro ao listar usuários.");
      }
      res.send(rows);
  });
});

// Rota PUT para atualizar usuários com autenticação de administrador
app.put('/api/users/:id', authenticateAdmin, authenticateAdmin, (req, res) => {
  const { id } = req.params;
  const { name, email, password, isAdmin } = req.body;

  const updateUser = (hashedPassword) => {
    db.run(
      "UPDATE Users SET name = ?, email = ?, password = COALESCE(?, password), isAdmin = ? WHERE id = ?",
      [name, email, hashedPassword, isAdmin ? 1 : 0, id],
      function (err) {
        if (err) {
          return res.status(500).send("Erro ao atualizar o usuário.");
        }
        res.send("Usuário atualizado com sucesso.");
      }
    );
  };

  if (password) {
    bcrypt.hash(password, 10, (err, hashedPassword) => {
      if (err) {
        return res.status(500).send("Erro ao hashear a senha.");
      }
      updateUser(hashedPassword);
    });
  } else {
    updateUser(null);
  }
});

// Rota DELETE para deletar usuários com autenticação de administrador
app.delete('/api/users/:id', authenticateAdmin,authenticateAdmin, (req, res) => {
  const { id } = req.params;

  db.run("DELETE FROM Users WHERE id = ?", [id], function (err) {
    if (err) {
      return res.status(500).send("Erro ao deletar o usuário.");
    }
    res.send("Usuário deletado com sucesso.");
  });
});


app.listen(port, async () => {
  console.log((`Servidor rodando em http://localhost:${port}`));
  console.log((`Documentação rodando em http://localhost:${port}/api-docs`));
});

import("open").then(open => {
  open.default(`http://localhost:${port}`);
});
