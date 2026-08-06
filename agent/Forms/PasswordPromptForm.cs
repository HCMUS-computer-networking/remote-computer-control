using System;
using System.Drawing;
using System.Windows.Forms;
using AgentSystem.Managers;

namespace AgentSystem.Forms
{
    public class PasswordPromptForm : Form
    {
        private TextBox txtPassword;
        private Button btnSubmit;
        public bool IsAuthenticated { get; private set; } = false;

        public PasswordPromptForm()
        {
            this.Text = "Administrator Authentication";
            this.Size = new Size(300, 150);
            this.StartPosition = FormStartPosition.CenterScreen;
            this.FormBorderStyle = FormBorderStyle.FixedDialog;
            this.MaximizeBox = false;
            this.MinimizeBox = false;
            this.TopMost = true;

            Label lbl = new Label
            {
                Text = "Please enter the tray icon password:",
                Location = new Point(20, 20),
                AutoSize = true
            };
            this.Controls.Add(lbl);

            txtPassword = new TextBox
            {
                Location = new Point(20, 45),
                Size = new Size(240, 20),
                UseSystemPasswordChar = true
            };
            txtPassword.KeyDown += (s, e) => { if (e.KeyCode == Keys.Enter) btnSubmit.PerformClick(); };
            this.Controls.Add(txtPassword);

            btnSubmit = new Button
            {
                Text = "Confirm",
                Location = new Point(100, 75),
                Size = new Size(80, 25)
            };
            btnSubmit.Click += BtnSubmit_Click;
            this.Controls.Add(btnSubmit);
        }

        private void BtnSubmit_Click(object sender, EventArgs e)
        {
            if (txtPassword.Text == ConfigManager.Current.TrayPassword)
            {
                IsAuthenticated = true;
                this.Close();
            }
            else
            {
                MessageBox.Show("Incorrect password!", "Error", MessageBoxButtons.OK, MessageBoxIcon.Error);
                txtPassword.Clear();
                txtPassword.Focus();
            }
        }
    }
}
