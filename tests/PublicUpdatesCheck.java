import com.kgb.feral.PublicUpdates;
import java.io.*;
import java.net.*;
import javax.net.ssl.HttpsURLConnection;
import java.security.cert.Certificate;

public final class PublicUpdatesCheck {
    static int count;
    static void ok(boolean condition,String label){if(!condition)throw new AssertionError(label);count++;}
    interface Action {void run() throws Exception;}
    static void rejects(Action action,String label)throws Exception{try{action.run();}catch(IOException expected){count++;return;}throw new AssertionError(label);}
    static class Response extends HttpsURLConnection {
        int status=200;byte[] bytes="public package".getBytes();String location;long length=-1;boolean closed;
        Response(URL u){super(u);}
        public void disconnect(){closed=true;}
        public boolean usingProxy(){return false;}
        public void connect(){}
        public String getCipherSuite(){return "TLS";}
        public Certificate[] getLocalCertificates(){return null;}
        public Certificate[] getServerCertificates(){return null;}
        public int getResponseCode(){return status;}
        public String getHeaderField(String name){return "Location".equals(name)?location:null;}
        public long getContentLengthLong(){return length;}
        public InputStream getInputStream(){return new ByteArrayInputStream(bytes);}
    }
    public static void main(String[] args)throws Exception {
        String stable=PublicUpdates.address("stable.feral");
        Response r=new Response(new URL(stable));
        ok(new String(PublicUpdates.download(stable,100,url->r)).equals("public package"),"download with no credentials");
        ok(r.getRequestProperty("Authorization")==null,"no authorization header");
        ok(r.closed,"connection closed after success");
        ok(PublicUpdates.address("catalog.json").endsWith("/updates/catalog.json"),"public catalog");
        ok(PublicUpdates.address("builds/1000004.feral").endsWith("/builds/1000004.feral"),"immutable build address");
        rejects(()->PublicUpdates.address("../main/anything"),"traversal");
        rejects(()->PublicUpdates.download("http://raw.githubusercontent.com/Modopi/feral-voxel-sandbox/updates/stable.feral",100,url->r),"https only");
        rejects(()->PublicUpdates.download("https://example.com/stable.feral",100,url->r),"host allowlist");
        rejects(()->PublicUpdates.download("https://user:secret@raw.githubusercontent.com/Modopi/feral-voxel-sandbox/updates/stable.feral",100,url->r),"embedded credentials");
        Response redirect=new Response(new URL(stable));redirect.status=302;redirect.location="https://example.com/steal";
        rejects(()->PublicUpdates.download(stable,100,url->redirect),"cross-host redirect");ok(redirect.closed,"redirect disconnected");
        Response large=new Response(new URL(stable));large.length=999;
        rejects(()->PublicUpdates.download(stable,10,url->large),"declared size bound");
        rejects(()->PublicUpdates.download(stable,3,url->r),"streaming size bound");
        Response missing=new Response(new URL(stable));missing.status=404;
        rejects(()->PublicUpdates.download(stable,100,url->missing),"unpublished version does not return a package");
        Response rate=new Response(new URL(stable));rate.status=429;
        rejects(()->PublicUpdates.download(stable,100,url->rate),"public rate limiting");
        System.out.println("Public transport checks: "+count);
    }
}
